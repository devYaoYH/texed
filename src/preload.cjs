const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("texSidecar", {
  initialTarget: () => ipcRenderer.invoke("app:initialTarget"),
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  refreshTree: (rootPath) => ipcRenderer.invoke("workspace:tree", rootPath),
  readFile: (payload) => ipcRenderer.invoke("file:read", payload),
  saveFile: (payload) => ipcRenderer.invoke("file:save", payload),
  compileTex: (payload) => ipcRenderer.invoke("tex:compile", payload),
  basename: (filePath) => ipcRenderer.invoke("path:basename", filePath)
});
