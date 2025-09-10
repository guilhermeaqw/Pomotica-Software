const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { shell } = require('electron');

let tray = null;
let mainWindow = null;

function createTray() {
  try {
    const trayIcon = nativeImage.createEmpty();
    tray = new Tray(trayIcon);
    tray.setToolTip('Pomotica');
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Mostrar', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: 'Verificar atualizações', click: () => autoUpdater.checkForUpdates().catch((e) => log.error(e)) },
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
      contextIsolation: false
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

function sendUpdateStatus(payload) {
  try { if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('update-status', payload); } catch (e) { log.error(e); }
}

function setupAutoUpdate() {
  // Logger e configuração
  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.allowPrerelease = true; // caso a release seja marcada como pre-release
  try {
    autoUpdater.setFeedURL({ provider: 'github', owner: 'guilhermeaqw', repo: 'Pomotica-Software' });
  } catch (e) {
    log.warn('setFeedURL falhou (usando config embutida):', e);
  }

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ type: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    if (tray) tray.setToolTip('Pomotica - Baixando atualização...');
    sendUpdateStatus({ type: 'available', info });
  });
  autoUpdater.on('update-not-available', (info) => {
    if (tray) tray.setToolTip('Pomotica');
    sendUpdateStatus({ type: 'not-available', info });
  });
  autoUpdater.on('download-progress', (p) => {
    if (tray) tray.setToolTip(`Pomotica - Baixando (${Math.round(p.percent)}%)`);
    sendUpdateStatus({ type: 'progress', percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond });
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (tray) tray.setToolTip('Pomotica - Atualização pronta');
    sendUpdateStatus({ type: 'downloaded', info });
    dialog.showMessageBox({
      type: 'info', buttons: ['Reiniciar agora', 'Depois'], defaultId: 0,
      title: 'Atualização', message: 'Uma atualização foi baixada. Deseja reiniciar para aplicar?'
    }).then(res => { if (res.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', (err) => {
    if (tray) tray.setToolTip('Pomotica');
    log.error('Updater error:', err);
    sendUpdateStatus({ type: 'error', message: String(err && err.message || err) });
  });
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Pomotica-Updater' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Pomotica-Updater' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total) onProgress(Math.round((received / total) * 100));
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// IPC para controle manual a partir do renderer
ipcMain.handle('update-check', async () => {
  try {
    sendUpdateStatus({ type: 'checking' });
    const r = await autoUpdater.checkForUpdates();
    // Se não for autoDownload, poderíamos chamar autoUpdater.downloadUpdate();
    return !!r;
  } catch (e) {
    sendUpdateStatus({ type: 'error', message: String(e && e.message || e) });
    return false;
  }
});
ipcMain.handle('update-install', async () => { try { autoUpdater.quitAndInstall(); return true; } catch { return false; } });
ipcMain.handle('fallback-update', async () => {
  try {
    sendUpdateStatus({ type: 'checking' });
    const api = await fetchJson('https://api.github.com/repos/guilhermeaqw/Pomotica-Software/releases/latest');
    const asset = (api.assets || []).find(a => /\.exe$/i.test(a.name));
    if (!asset) {
      sendUpdateStatus({ type: 'error', message: 'Nenhum instalador encontrado na última release.' });
      return false;
    }
    const tmp = path.join(os.tmpdir(), asset.name);
    sendUpdateStatus({ type: 'available' });
    await downloadFile(asset.browser_download_url, tmp, (p) => sendUpdateStatus({ type: 'progress', percent: p }));
    sendUpdateStatus({ type: 'downloaded' });
    // Abrir instalador; o usuário confirma a instalação
    shell.openPath(tmp);
    return true;
  } catch (e) {
    sendUpdateStatus({ type: 'error', message: String(e && e.message || e) });
    return false;
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  setupAutoUpdate();
  // Checar no início
  autoUpdater.checkForUpdates().catch((e) => log.error(e));

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
