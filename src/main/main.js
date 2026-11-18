const { app, BrowserWindow } = require('electron');
const { registerSchemes, registerMediaProtocol } = require('./app/protocol');
const { createMainWindow } = require('./app/window');
const { registerIpcHandlers } = require('./ipc/register');
const { flushAllSync } = require('./stores/json-store');
const stream = require('./services/stream');
const podcastRecorder = require('./services/podcast/recorder');
const podcastExporter = require('./services/podcast/exporter');
const { startScheduler } = require('./services/scheduler/scheduler');
const { initAutoUpdater } = require('./services/updater/auto-updater');

// Debe ir antes de app.ready.
registerSchemes();

// Menos procesos/servicios de Chromium que esta app no usa, y tope de heap
// para el renderer (la UI es ligera: 256 MB sobran).
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter,OptimizationHints');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');

let mainWindow = null;
const getWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);

function openMainWindow() {
  mainWindow = createMainWindow();
  mainWindow.on('closed', () => { mainWindow = null; });
}

function shutdownServices() {
  podcastExporter.cancelExport();
  podcastRecorder.shutdown();
  stream.shutdown();
  flushAllSync();
}

// Instancia unica: un segundo arranque solo enfoca la ventana existente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    registerMediaProtocol();
    registerIpcHandlers(getWindow);
    openMainWindow();
    startScheduler(getWindow);
    // El updater (pesado) se inicializa cuando la ventana ya esta en pantalla.
    setTimeout(() => initAutoUpdater(getWindow), 4000).unref?.();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    shutdownServices();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', shutdownServices);
}
