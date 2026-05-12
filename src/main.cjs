const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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
