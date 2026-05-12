# TeX Sidecar

A local desktop TeX editor with a collapsible workspace tree, side-by-side source editing, and generated PDF preview.

## Editor Features

- TeX syntax highlighting through the local Ace editor bundle.
- Source and Writing modes for switching between full source and a softer drafting surface.
- Writing mode hides common TeX scaffolding and shows editable title, author, date, headings, prose, and `$$ ... $$` math blocks.
- Writing mode includes insert controls for text, sections, subsections, math, figures, and tables.
- Source mode still supports folding for TeX document sections and repeated scaffolding commands such as `\usepackage{...}`.
- A file tree refresh button for reloading sidebar contents after external file changes or PDF generation.

## Run Locally

```sh
npm install
npm run dev
```

Open `examples/sample`, select `main.tex`, edit, save, and click **Compile PDF**.

To launch directly into a file or folder:

```sh
npm run dev -- examples/sample/main.tex
npm run dev -- examples/sample
```

The app uses the local TeX installation through `latexmk`, so macOS users should install a TeX distribution such as TinyTeX, MacTeX, or BasicTeX before compiling documents.

## Package

```sh
npm run package
```

This creates an unpacked macOS app at:

```text
dist/mac-arm64/TeX Sidecar.app
```

For distributable `.dmg` or `.zip` artifacts:

```sh
npm run dist
```

Signing and notarization require an Apple Developer ID certificate.

## Desktop Deployment Options

Electron is the best first choice for this app because it has mature file-system access, native dialogs, simple PDF preview support, and a very large packaging ecosystem. It is heavier than the alternatives, but the TeX workflow benefits from its reliable Node bridge to local tools like `latexmk`.

Tauri is the strongest lean alternative. It produces smaller apps and uses the OS webview, but file watching, process execution, PDF preview behavior, and installer setup require more Rust-side wiring.

Neutralino is very lightweight and good for small utilities. For a full editor with compiler integration, project navigation, and richer preview state, it will likely need more custom plumbing.

Flutter desktop is polished for native-feeling UI, but embedding a serious code editor and PDF preview is more work than using the browser/editor ecosystem inside Electron.

## Good Next Upgrades

- Add richer block editing in Writing mode for inserting sections, math, figures, and tables without touching raw TeX.
- Add root-file detection from `% !TEX root = ...` comments.
- Add file watching for automatic PDF refresh after external edits.
- Parse `.log` output into clickable diagnostics.
- Add app icons, signing, and notarized macOS distribution.
