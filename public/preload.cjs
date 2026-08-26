const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gatewayRoute", Object.freeze({
  activate: proxy => ipcRenderer.invoke("route:activate", proxy),
  deactivate: () => ipcRenderer.invoke("route:deactivate"),
  detectDiscord: () => ipcRenderer.invoke("discord:detect"),
  selectDiscord: executable => ipcRenderer.invoke("discord:select", executable),
  chooseDiscord: () => ipcRenderer.invoke("discord:choose"),
  restartDiscord: () => ipcRenderer.invoke("discord:restart"),
  launchDiscordDirect: () => ipcRenderer.invoke("discord:launch-direct"),
  getStatus: () => ipcRenderer.invoke("app:status"),
  getVersion: () => ipcRenderer.invoke("app:version"),
  getDiagnostics: () => ipcRenderer.invoke("diagnostics:get"),
  copyOutput: text => ipcRenderer.invoke("output:copy", text),
  openLog: () => ipcRenderer.invoke("app:open-log"),
  checkUpdate: () => ipcRenderer.invoke("app:check-update"),
  downloadUpdate: () => ipcRenderer.invoke("app:download-update"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  getPreferences: () => ipcRenderer.invoke("preferences:get"),
  setStartWithWindows: enabled => ipcRenderer.invoke("preferences:set-start-with-windows", enabled),
  activateGoLive: () => ipcRenderer.invoke("app:activate-golive"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  onStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("status:update", listener);
    return () => ipcRenderer.removeListener("status:update", listener);
  },
  onUpdateProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
  onClearSensitiveFields: callback => {
    const listener = () => callback();
    ipcRenderer.on("security:clear-sensitive-fields", listener);
    return () => ipcRenderer.removeListener("security:clear-sensitive-fields", listener);
  }
}));
