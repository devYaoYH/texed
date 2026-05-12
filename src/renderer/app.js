const state = {
  rootPath: null,
  tree: [],
  currentFile: null,
  currentExtension: null,
  dirty: false,
  expanded: new Set(),
  selectedPath: null,
  editorMode: "source"
};

ace.config.set("basePath", "../../node_modules/ace-builds/src-min-noconflict");

const editor = ace.edit("editor", {
  mode: "ace/mode/latex",
  theme: "ace/theme/one_dark",
  fontSize: 14,
  showPrintMargin: false,
  wrap: true,
  useWorker: false,
  tabSize: 2
});

editor.session.setUseWrapMode(true);
editor.session.setFoldStyle("markbeginend");
editor.setOption("placeholder", "Open a .tex file to start editing.");

const els = {
  shell: document.querySelector(".app-shell"),
  toggleSidebar: document.querySelector("#toggle-sidebar"),
  toggleSidebarIcon: document.querySelector("#toggle-sidebar-icon"),
  openFolder: document.querySelector("#open-folder"),
  refreshTree: document.querySelector("#refresh-tree"),
  foldTex: document.querySelector("#fold-tex"),
  sourceMode: document.querySelector("#source-mode"),
  writingMode: document.querySelector("#writing-mode"),
  fileTree: document.querySelector("#file-tree"),
  workspaceLabel: document.querySelector("#workspace-label"),
  fileName: document.querySelector("#file-name"),
  filePath: document.querySelector("#file-path"),
  saveFile: document.querySelector("#save-file"),
  compileFile: document.querySelector("#compile-file"),
  statusbar: document.querySelector("#statusbar"),
  pdfFrame: document.querySelector("#pdf-frame"),
  previewEmpty: document.querySelector("#preview-empty")
};

function setStatus(message, isError = false) {
  els.statusbar.textContent = message;
  els.statusbar.classList.toggle("error", isError);
}

function setDirty(dirty) {
  state.dirty = dirty;
  const baseName = state.currentFile ? state.currentFile.split(/[\\/]/).pop() : "Untitled workspace";
  els.fileName.textContent = dirty ? `${baseName} *` : baseName;
}

function canEditNode(node) {
  return node.type === "file" && node.editable;
}

function iconForNode(node, expanded) {
  if (node.type === "directory") return expanded ? "v" : ">";
  if (node.extension === ".tex") return "T";
  if (node.extension === ".bib") return "B";
  if (node.extension === ".pdf") return "P";
  return "-";
}

function renderTree(nodes, container) {
  container.innerHTML = "";

  for (const node of nodes) {
    const wrapper = document.createElement("div");
    const expanded = state.expanded.has(node.path);
    wrapper.className = `tree-node ${expanded ? "" : "collapsed"}`;

    const row = document.createElement("button");
    row.type = "button";
    row.className = "tree-row";
    row.title = node.path;

    if (state.selectedPath === node.path) row.classList.add("active");
    if (node.type === "file" && !canEditNode(node)) row.classList.add("disabled");

    const marker = document.createElement("span");
    marker.textContent = iconForNode(node, expanded);

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.name;

    row.append(marker, label);
    wrapper.append(row);

    row.addEventListener("click", () => {
      if (node.type === "directory") {
        if (state.expanded.has(node.path)) {
          state.expanded.delete(node.path);
        } else {
          state.expanded.add(node.path);
        }
        renderWorkspaceTree();
        return;
      }

      if (canEditNode(node)) {
        openFile(node.path);
      } else {
        setStatus("Only text-based TeX project files can be opened in the editor.", true);
      }
    });

    if (node.type === "directory") {
      const children = document.createElement("div");
      children.className = "tree-children";
      renderTree(node.children || [], children);
      wrapper.append(children);
    }

    container.append(wrapper);
  }
}

function renderWorkspaceTree() {
  renderTree(state.tree, els.fileTree);
}

function setEditorValue(content) {
  editor.setValue(content, -1);
  editor.clearSelection();
  editor.session.getUndoManager().reset();
}

function getEditorValue() {
  return editor.getValue();
}

function setMode(mode) {
  state.editorMode = mode;
  const writing = mode === "writing";
  els.sourceMode.classList.toggle("active", !writing);
  els.writingMode.classList.toggle("active", writing);
  editor.setTheme(writing ? "ace/theme/textmate" : "ace/theme/one_dark");
  editor.setFontSize(writing ? 16 : 14);
  editor.session.setUseWrapMode(true);

  if (state.currentExtension === ".tex") {
    if (writing) {
      foldTexScaffolding();
      setStatus("Writing mode folded common TeX scaffolding.");
    } else {
      editor.session.unfold();
      setStatus("Source mode shows the full TeX file.");
    }
  }
}

function leadingCommand(line) {
  const match = line.match(/^\\([A-Za-z]+)(?:\*?)\b/);
  return match ? match[1] : null;
}

function sectionLevel(line) {
  const match = line.match(/^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{/);
  if (!match) return null;
  return ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"].indexOf(match[1]);
}

function sectionTitle(line) {
  const match = line.match(/^\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/);
  return match ? match[1].trim() : "section";
}

function addFold(startRow, endRow, placeholder) {
  if (endRow <= startRow) return;
  const Range = ace.require("ace/range").Range;
  try {
    editor.session.addFold(placeholder, new Range(startRow, 0, endRow, editor.session.getLine(endRow).length));
  } catch {
    // Ace skips overlapping folds by throwing; the rest of the file remains usable.
  }
}

function foldRepeatedCommands(lines, commandName, label) {
  let start = null;

  for (let row = 0; row <= lines.length; row += 1) {
    const command = row < lines.length ? leadingCommand(lines[row].trim()) : null;
    if (command === commandName) {
      if (start === null) start = row;
      continue;
    }

    if (start !== null && row - start > 1) {
      addFold(start, row - 1, `${label}...`);
    }

    start = null;
  }
}

function foldPreamble(lines) {
  const beginRow = lines.findIndex((line) => /^\\begin\{document\}/.test(line.trim()));
  if (beginRow > 1) addFold(0, beginRow - 1, "preamble...");
}

function foldSections(lines) {
  const sections = [];

  lines.forEach((line, row) => {
    const trimmed = line.trim();
    const level = sectionLevel(trimmed);
    if (level !== null) sections.push({ row, level, title: sectionTitle(trimmed) });
  });

  for (let index = 0; index < sections.length; index += 1) {
    const current = sections[index];
    const next = sections.find((candidate, candidateIndex) => candidateIndex > index && candidate.level <= current.level);
    const endRow = next ? next.row - 1 : lines.length - 1;
    addFold(current.row, endRow, `${current.title}...`);
  }
}

function foldTexScaffolding() {
  if (state.currentExtension !== ".tex") return;
  editor.session.unfold();
  const lines = editor.session.getDocument().getAllLines();

  foldRepeatedCommands(lines, "usepackage", "\\usepackage");
  foldRepeatedCommands(lines, "newcommand", "\\newcommand");
  foldRepeatedCommands(lines, "renewcommand", "\\renewcommand");
  foldPreamble(lines);
  foldSections(lines);
}

async function openWorkspace() {
  try {
    const workspace = await window.texSidecar.openWorkspace();
    if (!workspace) return;

    state.rootPath = workspace.rootPath;
    state.tree = workspace.tree;
    state.expanded = new Set([workspace.rootPath]);
    state.currentFile = null;
    state.currentExtension = null;
    state.selectedPath = null;
    els.workspaceLabel.textContent = workspace.rootPath;
    els.fileName.textContent = "No file selected";
    els.filePath.textContent = "Choose a .tex, .bib, .sty, or .cls file from the tree.";
    setEditorValue("");
    els.saveFile.disabled = true;
    els.compileFile.disabled = true;
    els.foldTex.disabled = true;
    setDirty(false);
    renderWorkspaceTree();
    setStatus("Workspace opened.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function refreshTree() {
  if (!state.rootPath) return;

  try {
    state.tree = await window.texSidecar.refreshTree(state.rootPath);
    renderWorkspaceTree();
    setStatus("File tree refreshed.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function openFile(filePath) {
  if (state.dirty) {
    const ok = confirm("You have unsaved edits. Open another file anyway?");
    if (!ok) return;
  }

  try {
    const file = await window.texSidecar.readFile({
      rootPath: state.rootPath,
      filePath
    });

    state.currentFile = file.filePath;
    state.currentExtension = file.extension;
    state.selectedPath = file.filePath;
    setEditorValue(file.content);
    editor.session.setMode(file.extension === ".tex" ? "ace/mode/latex" : "ace/mode/text");
    els.filePath.textContent = file.filePath;
    els.saveFile.disabled = false;
    els.compileFile.disabled = file.extension !== ".tex";
    els.foldTex.disabled = file.extension !== ".tex";
    setDirty(false);
    if (state.editorMode === "writing" && file.extension === ".tex") foldTexScaffolding();
    renderWorkspaceTree();
    setStatus("File opened.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function saveFile() {
  if (!state.currentFile) return;

  try {
    await window.texSidecar.saveFile({
      rootPath: state.rootPath,
      filePath: state.currentFile,
      content: getEditorValue()
    });
    setDirty(false);
    setStatus("Saved.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function compileFile() {
  if (!state.currentFile) return;

  if (state.dirty) {
    await saveFile();
    if (state.dirty) return;
  }

  els.compileFile.disabled = true;
  setStatus("Compiling PDF with latexmk...");

  try {
    const result = await window.texSidecar.compileTex({
      rootPath: state.rootPath,
      filePath: state.currentFile
    });

    if (result.pdfUrl) {
      els.pdfFrame.src = result.pdfUrl;
      els.pdfFrame.style.display = "block";
      els.previewEmpty.style.display = "none";
    }

    if (result.ok) {
      setStatus("PDF compiled.");
      await refreshTree();
    } else {
      const output = `${result.stdout}\n${result.stderr}`.trim();
      setStatus(output ? output.slice(-900) : `latexmk exited with code ${result.code}.`, true);
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    els.compileFile.disabled = !state.currentFile || !state.currentFile.endsWith(".tex");
  }
}

els.openFolder.addEventListener("click", openWorkspace);
els.refreshTree.addEventListener("click", refreshTree);
els.foldTex.addEventListener("click", foldTexScaffolding);
els.sourceMode.addEventListener("click", () => setMode("source"));
els.writingMode.addEventListener("click", () => setMode("writing"));
els.saveFile.addEventListener("click", saveFile);
els.compileFile.addEventListener("click", compileFile);

els.toggleSidebar.addEventListener("click", () => {
  const collapsed = els.shell.classList.toggle("sidebar-collapsed");
  els.toggleSidebar.title = collapsed ? "Expand file tree" : "Collapse file tree";
  els.toggleSidebar.ariaLabel = collapsed ? "Expand file tree" : "Collapse file tree";
  els.toggleSidebarIcon.textContent = collapsed ? "]" : "[";
});

editor.session.on("change", () => {
  if (state.currentFile) setDirty(true);
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveFile();
  }

  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    compileFile();
  }
});
