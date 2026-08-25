const { app, BrowserWindow, dialog, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const libraryManager = require('./library-manager');
const mediaPreviewStore = require('./media-preview-store');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'streamradio',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);
const { registerIpcHandlers } = require('./ipc-handlers');
const { initAutoUpdater } = require('./auto-updater');
const ffmpegStream = require('./ffmpeg-stream');
const podcastRecorder = require('./podcast-recorder');
const podcastExporter = require('./podcast-exporter');
const { startScheduler } = require('./scheduler');

let mainWindow = null;
let forceClose = false;

function writeRuntimeDiagnostic(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.promises.mkdir(app.getPath('logs'), { recursive: true })
    .then(() => fs.promises.appendFile(path.join(app.getPath('logs'), 'stream-radio-runtime.log'), line, 'utf8'))
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Bloqueo de instancia unica: sin esto, cualquier doble arranque (doble
// clic accidental, el instalador reabriendo la app tras "Ejecutar ahora",
// etc.) crea una SEGUNDA ventana completa en vez de simplemente enfocar la
// que ya esta abierta -- esto era el bug de "se me abren dos pestañas".
// ---------------------------------------------------------------------------
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  bootstrapApp();
}

function registerLibraryMediaProtocol() {
  protocol.registerFileProtocol('streamradio', (request, callback) => {
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.hostname !== 'track' && requestUrl.hostname !== 'podcast') {
        callback({ error: -6 });
        return;
      }

      const resourceId = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ''));
      const filePath = requestUrl.hostname === 'track'
        ? libraryManager.getTrackPath(resourceId)
        : requestUrl.hostname === 'podcast'
          ? mediaPreviewStore.resolve(resourceId)
          : null;
      if (!filePath) {
        callback({ error: -6 });
        return;
      }

      fs.promises.access(filePath, fs.constants.R_OK)
        .then(() => callback({ path: filePath }))
        .catch(() => callback({ error: -6 }));
    } catch {
      callback({ error: -2 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1250,
    height: 780,
    minWidth: 640,
    minHeight: 680,
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'resources', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('unresponsive', () => writeRuntimeDiagnostic('La ventana de Electron reportó UNRESPONSIVE.'));
  mainWindow.on('responsive', () => writeRuntimeDiagnostic('La ventana de Electron volvió a responder.'));
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    writeRuntimeDiagnostic(`El proceso renderer terminó: reason=${details.reason || 'unknown'} exitCode=${details.exitCode ?? 'unknown'}.`);
  });
  mainWindow.webContents.on('crashed', () => writeRuntimeDiagnostic('El renderer reportó un crash.'));

  // ffmpeg-stream.js recibe mainWindow directamente en cada llamada desde
  // ipc-handlers.js (startStream(mainWindow, config) / stopStream(mainWindow))
  // para poder emitir stream:log, stream:status, stream:vu-level,
  // stream:intro-progress, stream:outro-progress.
  registerIpcHandlers(mainWindow);

  // Si hay una transmision activa y el usuario intenta cerrar la ventana,
  // confirmar primero: cerrar sin avisar cortaria el stream de inmediato,
  // sin reproducir el outro.
  mainWindow.on('close', (event) => {
    if (forceClose || !ffmpegStream.isStreaming()) return;

    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Cancelar', 'Detener y salir'],
      defaultId: 0,
      cancelId: 0,
      title: 'Transmision activa',
      message: 'Hay una transmision en curso.',
      detail: 'Si sales ahora la conexion se cortara de inmediato, sin reproducir el outro. ¿Deseas continuar?'
    });

    if (choice === 1) {
      forceClose = true;
      ffmpegStream.shutdown();
      mainWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function bootstrapApp() {
  app.whenReady().then(() => {
    registerLibraryMediaProtocol();
    createWindow();
    initAutoUpdater(mainWindow);
    startScheduler(mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    podcastExporter.cancelExport();
    podcastRecorder.shutdown();
    ffmpegStream.shutdown();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    podcastExporter.cancelExport();
    podcastRecorder.shutdown();
    ffmpegStream.shutdown();
  });
}
