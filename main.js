const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let tray = null;
let mainWindow = null;

function createTray() {
  try {
    const trayIcon = nativeImage.createEmpty();
    tray = new Tray(trayIcon);
    tray.setToolTip('Pomotica');
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Mostrar', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: 'Verificar atualizações', click: () => autoUpdater.checkForUpdatesAndNotify().catch(() => {}) },
      { label: 'Sair', click: () => app.quit() }
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); });
  } catch (_) {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0f0f23',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (e) => {
    if (process.platform === 'win32') {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function setupAutoUpdate() {
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', () => {
    if (tray) tray.setToolTip('Pomotica - Baixando atualização...');
  });
  autoUpdater.on('download-progress', (p) => {
    if (tray) tray.setToolTip(`Pomotica - Baixando (${Math.round(p.percent)}%)`);
  });
  autoUpdater.on('update-downloaded', () => {
    if (tray) tray.setToolTip('Pomotica - Atualização pronta');
    dialog.showMessageBox({
      type: 'info', buttons: ['Reiniciar agora', 'Depois'], defaultId: 0,
      title: 'Atualização', message: 'Uma atualização foi baixada. Deseja reiniciar para aplicar?'
    }).then(res => {
      if (res.response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on('error', () => {
    if (tray) tray.setToolTip('Pomotica');
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  setupAutoUpdate();
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('timer-tick', (_event, payload) => {
  if (tray && payload && payload.time) {
    tray.setToolTip(`Pomotica - ${payload.isBreak ? 'Pausa' : 'Foco'} ${payload.time}`);
  }
});
