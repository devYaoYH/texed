const state = {
  rootPath: null,
  tree: [],
  currentFile: null,
  currentExtension: null,
  dirty: false,
  expanded: new Set(),
  selectedPath: null,
  editorMode: "source",
  texDraft: null,
  suppressChange: false
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
  versionLabel: document.querySelector("#version-label"),
  workspaceLabel: document.querySelector("#workspace-label"),
  fileName: document.querySelector("#file-name"),
  filePath: document.querySelector("#file-path"),
  editorPane: document.querySelector(".editor-pane"),
  writingToolbar: document.querySelector("#writing-toolbar"),
  writingEditor: document.querySelector("#writing-editor"),
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

function loadWorkspace(workspace, message = "Workspace opened.") {
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
  els.writingEditor.innerHTML = "";
  els.saveFile.disabled = true;
  els.compileFile.disabled = true;
  els.foldTex.disabled = true;
  els.writingMode.disabled = true;
  setDirty(false);
  renderWorkspaceTree();
  setStatus(message);
}

function setEditorValue(content) {
  state.suppressChange = true;
  editor.setValue(content, -1);
  editor.clearSelection();
  editor.session.getUndoManager().reset();
  state.suppressChange = false;
}

function getEditorValue() {
  if (state.editorMode === "writing" && state.currentExtension === ".tex") {
    return writingToTex();
  }

  return editor.getValue();
}

function setMode(mode) {
  if (mode === state.editorMode) return;
  if (mode === "writing" && state.currentExtension !== ".tex") {
    setStatus("Writing mode is available for .tex files.", true);
    return;
  }

  if (state.editorMode === "writing" && state.currentExtension === ".tex") {
    setEditorValue(writingToTex());
  }

  state.editorMode = mode;
  const writing = mode === "writing";
  els.sourceMode.classList.toggle("active", !writing);
  els.writingMode.classList.toggle("active", writing);
  els.writingMode.disabled = state.currentExtension !== ".tex";
  els.editorPane.classList.toggle("writing-active", writing);
  els.foldTex.disabled = writing || state.currentExtension !== ".tex";
  editor.setTheme(writing ? "ace/theme/textmate" : "ace/theme/one_dark");
  editor.setFontSize(writing ? 16 : 14);
  editor.session.setUseWrapMode(true);

  if (state.currentExtension === ".tex") {
    if (writing) {
      renderWritingView(editor.getValue());
      setStatus("Writing mode is showing the document, not the TeX scaffolding.");
    } else {
      editor.session.unfold();
      setStatus("Source mode shows the full TeX file.");
    }
  }
}

async function loadVersionInfo() {
  try {
    const info = await window.texSidecar.versionInfo();
    els.versionLabel.textContent = `v${info.version} - ${info.hash}`;
  } catch {
    els.versionLabel.textContent = "vunknown - unknown";
  }
}

function commandValue(source, command) {
  const match = source.match(new RegExp(`\\\\${command}\\s*\\{([^}]*)\\}`));
  return match ? match[1].trim() : "";
}

function parseTexForWriting(source) {
  const beginMatch = source.match(/\\begin\{document\}/);
  const endMatch = source.match(/\\end\{document\}/);
  const preambleEnd = beginMatch ? beginMatch.index : source.length;
  const bodyStart = beginMatch ? beginMatch.index + beginMatch[0].length : 0;
  const bodyEnd = endMatch ? endMatch.index : source.length;
  const preamble = source.slice(0, preambleEnd).trimEnd();
  const body = source.slice(bodyStart, bodyEnd).trim();
  const lines = body.split(/\r?\n/);
  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed === "\\maketitle") {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^\\(section|subsection|subsubsection)\*?\{([^}]*)\}/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: heading[1], text: heading[2].trim() });
      continue;
    }

    if (trimmed === "\\begin{figure}") {
      flushParagraph();
      const artifactLines = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "\\end{figure}") {
        artifactLines.push(lines[index]);
        index += 1;
      }
      blocks.push(parseArtifactBlock("figure", artifactLines));
      continue;
    }

    if (trimmed === "\\begin{table}") {
      flushParagraph();
      const artifactLines = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "\\end{table}") {
        artifactLines.push(lines[index]);
        index += 1;
      }
      blocks.push(parseArtifactBlock("table", artifactLines));
      continue;
    }

    if (trimmed === "\\[") {
      flushParagraph();
      const mathLines = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "\\]") {
        mathLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "math", text: mathLines.join("\n").trimEnd() });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();

  return {
    preamble,
    title: commandValue(source, "title"),
    author: commandValue(source, "author"),
    date: commandValue(source, "date"),
    blocks
  };
}

function parseArtifactBlock(type, lines) {
  const captionIndex = lines.findIndex((line) => line.trim().startsWith("\\caption{"));
  const caption = captionIndex >= 0 ? lines[captionIndex].trim().replace(/^\\caption\{/, "").replace(/\}$/, "") : "";
  const body = lines.filter((_line, index) => index !== captionIndex).join("\n").trim();
  return { type, caption, body };
}

function artifactText(block, fallbackCaption) {
  return `${block.caption || fallbackCaption}\n---\n${block.body || ""}`.trimEnd();
}

function editableBlock(className, type, text) {
  const block = document.createElement("div");
  block.className = `writing-block ${className}`;
  block.dataset.type = type;
  block.contentEditable = "true";
  block.spellcheck = true;
  block.textContent = text;
  return block;
}

function blockElement(block) {
  if (block.type === "section") return editableBlock("writing-section", "section", block.text);
  if (block.type === "subsection" || block.type === "subsubsection") return editableBlock("writing-subsection", block.type, block.text);
  if (block.type === "math") return editableBlock("writing-math", "math", `$$\n${block.text}\n$$`);
  if (block.type === "figure") return editableBlock("writing-artifact writing-figure", "figure", artifactText(block, "Figure caption"));
  if (block.type === "table") return editableBlock("writing-artifact writing-table", "table", artifactText(block, "Table caption"));
  return editableBlock("writing-paragraph", "paragraph", block.text);
}

function renderWritingView(source) {
  state.texDraft = parseTexForWriting(source);
  els.writingEditor.innerHTML = "";

  els.writingEditor.append(
    editableBlock("writing-title", "title", state.texDraft.title || "Untitled"),
    editableBlock("writing-meta", "author", state.texDraft.author || "Author"),
    editableBlock("writing-meta", "date", state.texDraft.date || "\\today")
  );

  for (const block of state.texDraft.blocks) {
    els.writingEditor.append(blockElement(block));
  }

  if (state.texDraft.blocks.length === 0) {
    const placeholder = editableBlock("writing-paragraph writing-placeholder", "paragraph", "Start writing...");
    els.writingEditor.append(placeholder);
  }
}

function texEscapeHeading(text) {
  return text.replace(/\s+/g, " ").trim();
}

function mathFromWriting(text) {
  let math = text.trim();
  if (math.startsWith("$$")) math = math.slice(2);
  if (math.endsWith("$$")) math = math.slice(0, -2);
  return math.trim();
}

function artifactFromWriting(text) {
  const [captionPart, ...bodyParts] = text.split(/\n---\n/);
  return {
    caption: texEscapeHeading(captionPart || ""),
    body: bodyParts.join("\n---\n").trim()
  };
}

function blockToTex(block) {
  const type = block.dataset.type;
  const text = block.innerText.trim();
  if (!text) return "";

  if (type === "section") return `\\section{${texEscapeHeading(text)}}`;
  if (type === "subsection") return `\\subsection{${texEscapeHeading(text)}}`;
  if (type === "subsubsection") return `\\subsubsection{${texEscapeHeading(text)}}`;
  if (type === "math") return `\\[\n${mathFromWriting(text)}\n\\]`;
  if (type === "figure") {
    const artifact = artifactFromWriting(text);
    return `\\begin{figure}\n${artifact.body}\n\\caption{${artifact.caption}}\n\\end{figure}`;
  }
  if (type === "table") {
    const artifact = artifactFromWriting(text);
    return `\\begin{table}\n${artifact.body}\n\\caption{${artifact.caption}}\n\\end{table}`;
  }
  if (type === "paragraph") return text;
  return "";
}

function replaceOrAddCommand(preamble, command, value) {
  const line = `\\${command}{${value.trim()}}`;
  const pattern = new RegExp(`\\\\${command}\\s*\\{[^}]*\\}`);
  if (pattern.test(preamble)) return preamble.replace(pattern, line);
  return `${preamble.trimEnd()}\n${line}`;
}

function writingToTex() {
  const draft = state.texDraft || parseTexForWriting(editor.getValue());
  const blocks = Array.from(els.writingEditor.querySelectorAll(".writing-block"));
  const title = blocks.find((block) => block.dataset.type === "title")?.innerText.trim() || "Untitled";
  const author = blocks.find((block) => block.dataset.type === "author")?.innerText.trim() || "";
  const date = blocks.find((block) => block.dataset.type === "date")?.innerText.trim() || "\\today";
  let preamble = draft.preamble || "\\documentclass{article}";

  preamble = replaceOrAddCommand(preamble, "title", title);
  preamble = replaceOrAddCommand(preamble, "author", author);
  preamble = replaceOrAddCommand(preamble, "date", date);

  const body = blocks
    .filter((block) => !["title", "author", "date"].includes(block.dataset.type))
    .map(blockToTex)
    .filter(Boolean)
    .join("\n\n");

  return `${preamble.trimEnd()}\n\n\\begin{document}\n\\maketitle\n\n${body}\n\n\\end{document}\n`;
}

function defaultBlock(type) {
  if (type === "section") return { type, text: "New section" };
  if (type === "subsection") return { type, text: "New subsection" };
  if (type === "math") return { type, text: "a^2 + b^2 = c^2" };
  if (type === "figure") {
    return {
      type,
      caption: "Example figure caption",
      body: "\\centering\n\\fbox{\\rule{0pt}{1.2in}\\rule{2.4in}{0pt}}"
    };
  }
  if (type === "table") {
    return {
      type,
      caption: "Example data table",
      body: "\\centering\n\\begin{tabular}{lrr}\nItem & Count & Share \\\\\nAlpha & 12 & 40\\% \\\\\nBeta & 18 & 60\\% \\\\\n\\end{tabular}"
    };
  }
  return { type: "paragraph", text: "New paragraph text." };
}

function selectedWritingBlock() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const node = selection.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.(".writing-block") || null;
}

function focusBlock(block) {
  block.focus();
  const range = document.createRange();
  range.selectNodeContents(block);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertWritingBlock(type) {
  if (state.editorMode !== "writing" || state.currentExtension !== ".tex") {
    setStatus("Switch to Writing mode on a .tex file before inserting blocks.", true);
    return;
  }

  const block = blockElement(defaultBlock(type));
  const selected = selectedWritingBlock();
  if (selected && !["title", "author", "date"].includes(selected.dataset.type)) {
    selected.after(block);
  } else {
    els.writingEditor.append(block);
  }

  focusBlock(block);
  setDirty(true);
  setStatus(`Inserted ${type} block.`);
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

    loadWorkspace(workspace);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function openInitialTarget() {
  try {
    const target = await window.texSidecar.initialTarget();
    if (!target) return;

    if (target.error) {
      setStatus(`Could not open CLI target: ${target.error}`, true);
      return;
    }

    loadWorkspace(target, target.filePath ? "Workspace opened from CLI argument." : "Folder opened from CLI argument.");
    if (target.filePath) await openFile(target.filePath);
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
    if (file.extension !== ".tex") setMode("source");
    setEditorValue(file.content);
    editor.session.setMode(file.extension === ".tex" ? "ace/mode/latex" : "ace/mode/text");
    els.filePath.textContent = file.filePath;
    els.saveFile.disabled = false;
    els.compileFile.disabled = file.extension !== ".tex";
    els.foldTex.disabled = file.extension !== ".tex" || state.editorMode === "writing";
    els.writingMode.disabled = file.extension !== ".tex";
    setDirty(false);
    if (state.editorMode === "writing" && file.extension === ".tex") renderWritingView(file.content);
    renderWorkspaceTree();
    setStatus("File opened.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function saveFile() {
  if (!state.currentFile) return;

  try {
    const content = getEditorValue();
    await window.texSidecar.saveFile({
      rootPath: state.rootPath,
      filePath: state.currentFile,
      content
    });
    if (state.editorMode === "writing" && state.currentExtension === ".tex") {
      setEditorValue(content);
      renderWritingView(content);
    }
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
els.writingToolbar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-insert-block]");
  if (!button) return;
  insertWritingBlock(button.dataset.insertBlock);
});

els.toggleSidebar.addEventListener("click", () => {
  const collapsed = els.shell.classList.toggle("sidebar-collapsed");
  els.toggleSidebar.title = collapsed ? "Expand file tree" : "Collapse file tree";
  els.toggleSidebar.ariaLabel = collapsed ? "Expand file tree" : "Collapse file tree";
  els.toggleSidebarIcon.textContent = collapsed ? "]" : "[";
});

editor.session.on("change", () => {
  if (state.suppressChange) return;
  if (state.currentFile) setDirty(true);
});

els.writingEditor.addEventListener("input", () => {
  if (state.currentFile && state.editorMode === "writing") setDirty(true);
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

openInitialTarget();
loadVersionInfo();
