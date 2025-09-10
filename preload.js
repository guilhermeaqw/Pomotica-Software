const { contextBridge, ipcRenderer } = require('electron');

const api = {
  timerTick: (payload) => ipcRenderer.send('timer-tick', payload),
  onUpdateStatus: (fn) => ipcRenderer.on('update-status', (_e, data) => fn && fn(data)),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install')
};

try {
  // Expor API e marcar disponibilidade
  contextBridge.exposeInMainWorld('electron', api);
  window.__updaterReady = true;
  ipcRenderer.send('preload-ready');
} catch (_) {
  // Fallback (quando contextIsolation: false)
  window.electron = api;
  window.__updaterReady = true;
}
