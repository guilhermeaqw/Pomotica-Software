const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  timerTick: (payload) => ipcRenderer.send('timer-tick', payload)
});
