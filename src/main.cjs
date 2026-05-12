const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const nodeFs = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const packageJson = require("../package.json");

const IGNORED_DIRS = new Set([
  ".git",
  ".idea",
  ".vscode",
  "node_modules",
  ".DS_Store",
  "__pycache__",
  ".latexmk",
  "dist",
  "build"
]);

const TEXT_EXTENSIONS = new Set([
  ".tex",
  ".bib",
  ".cls",
  ".sty",
  ".bbx",
  ".cbx",
  ".ltx",
  ".md",
  ".txt",
  ".log"
]);

let mainWindow;
let initialTargetPromise = null;
let rendererWatcher = null;
let rendererReloadTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: "TeX Sidecar",
    backgroundColor: "#f7f4ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  watchRendererForDevReload();
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function assertInsideRoot(rootPath, filePath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The requested file is outside the open workspace.");
  }

  return target;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function cliTargetArg() {
  const args = process.argv.slice(process.defaultApp ? 2 : 1);
  return args.find((arg) => !arg.startsWith("-")) || null;
}

function watchRendererForDevReload() {
  if (process.env.TEX_SIDECAR_DEV_RELOAD !== "1" || rendererWatcher) return;

  const rendererPath = path.join(__dirname, "renderer");
  rendererWatcher = nodeFs.watch(rendererPath, { recursive: true }, (_eventType, filename) => {
    if (!filename || !/\.(css|html|js)$/.test(filename)) return;

    clearTimeout(rendererReloadTimer);
    rendererReloadTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    }, 120);
  });

  rendererWatcher.on("error", (error) => {
    console.warn("Renderer auto-reload watcher stopped:", error.message);
  });
}

async function initialTarget() {
  const targetArg = cliTargetArg();
  if (!targetArg) return null;

  const targetPath = path.resolve(process.cwd(), targetArg);
  const stat = await fs.stat(targetPath);
  const rootPath = stat.isDirectory() ? targetPath : path.dirname(targetPath);

  return {
    rootPath,
    filePath: stat.isDirectory() ? null : targetPath,
    tree: await readTree(rootPath)
  };
}

async function readTree(rootPath, currentPath = rootPath) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const nodes = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(currentPath, entry.name);
    const node = {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? "directory" : "file"
    };

    if (entry.isDirectory()) {
      node.children = await readTree(rootPath, fullPath);
    } else {
      node.extension = path.extname(entry.name).toLowerCase();
      node.editable = TEXT_EXTENSIONS.has(node.extension);
    }

    nodes.push(node);
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ ok: false, code: -1, stdout, stderr: error.message });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function gitShortHash() {
  const result = await runCommand("git", ["rev-parse", "--short", "HEAD"], path.join(__dirname, ".."));
  return result.ok ? result.stdout.trim() : "unknown";
}

ipcMain.handle("workspace:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open TeX Workspace",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const rootPath = result.filePaths[0];
  return {
    rootPath,
    tree: await readTree(rootPath)
  };
});

ipcMain.handle("app:initialTarget", async () => {
  if (!initialTargetPromise) {
    initialTargetPromise = initialTarget().catch((error) => ({
      error: error.message
    }));
  }

  return initialTargetPromise;
});

ipcMain.handle("app:versionInfo", async () => ({
  version: packageJson.version,
  hash: await gitShortHash()
}));

ipcMain.handle("workspace:tree", async (_event, rootPath) => {
  return readTree(rootPath);
});

ipcMain.handle("file:read", async (_event, { rootPath, filePath }) => {
  const target = assertInsideRoot(rootPath, filePath);
  const ext = path.extname(target).toLowerCase();

  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error("This file type is not editable in TeX Sidecar yet.");
  }

  return {
    filePath: target,
    content: await fs.readFile(target, "utf8"),
    extension: ext
  };
});

ipcMain.handle("file:save", async (_event, { rootPath, filePath, content }) => {
  const target = assertInsideRoot(rootPath, filePath);
  await fs.writeFile(target, content, "utf8");
  return { ok: true, savedAt: new Date().toISOString() };
});

ipcMain.handle("tex:compile", async (_event, { rootPath, filePath }) => {
  const target = assertInsideRoot(rootPath, filePath);
  const ext = path.extname(target).toLowerCase();

  if (ext !== ".tex") {
    throw new Error("Select a .tex file before compiling.");
  }

  const cwd = path.dirname(target);
  const basename = path.basename(target);
  const pdfPath = path.join(cwd, `${path.basename(target, ext)}.pdf`);
  const args = [
    "-pdf",
    "-interaction=nonstopmode",
    "-synctex=1",
    "-file-line-error",
    basename
  ];

  const result = await runCommand("latexmk", args, cwd);
  const pdfReady = await pathExists(pdfPath);

  return {
    ...result,
    pdfPath: pdfReady ? pdfPath : null,
    pdfUrl: pdfReady ? `${pathToFileURL(pdfPath).href}?t=${Date.now()}` : null
  };
});

ipcMain.handle("path:basename", async (_event, filePath) => path.basename(filePath));
