const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const { initAutoUpdater } = require('./auto-updater');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1250,
    height: 780,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // TODO (Fase 2/4): pasar mainWindow al motor de streaming (ffmpeg-stream.js)
  // para poder emitir eventos IPC: stream:log, stream:status, stream:vu-level,
  // stream:intro-progress, stream:outro-progress.
  registerIpcHandlers(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
