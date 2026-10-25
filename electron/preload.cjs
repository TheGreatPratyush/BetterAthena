const { contextBridge, ipcRenderer } = require("electron");

// Expose only the IPC methods that the React app actually needs.
// Nothing else from Node or Electron is accessible to the renderer.
contextBridge.exposeInMainWorld("electronAPI", {
  setFullScreen: ()            => ipcRenderer.invoke("full-screen"),
  showExamRules: ()            => ipcRenderer.invoke("show-rules"),
  savePhoto:     (arrayBuffer) => ipcRenderer.invoke("save-photo", arrayBuffer),
  saveResult:    (resultData)  => ipcRenderer.invoke("save-result", resultData),
});
