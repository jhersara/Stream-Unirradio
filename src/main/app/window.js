const { BrowserWindow, dialog } = require('electron');
const stream = require('../services/stream');
const { RENDERER_ENTRY, PRELOAD_PATH, ICON_PATH } = require('../utils/paths');
const { writeRuntimeDiagnostic } = require('./diagnostics');

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1250,
    height: 780,
    minWidth: 640,
    minHeight: 680,
    show: false,
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  // Se muestra al tener el primer pintado (con respaldo por si no llega).
  const showFallback = setTimeout(() => { if (!win.isDestroyed()) win.show(); }, 5000);
  win.once('ready-to-show', () => {
    clearTimeout(showFallback);
    win.show();
  });

  win.loadFile(RENDERER_ENTRY);

  win.on('unresponsive', () => writeRuntimeDiagnostic('La ventana de Electron reportó UNRESPONSIVE.'));
  win.on('responsive', () => writeRuntimeDiagnostic('La ventana de Electron volvió a responder.'));
  win.webContents.on('render-process-gone', (event, details) => {
    writeRuntimeDiagnostic(`El proceso renderer terminó: reason=${details.reason || 'unknown'} exitCode=${details.exitCode ?? 'unknown'}.`);
  });

  // Minimizada u oculta: el vumetro/espectro dejan de calcularse.
  const syncVisibility = () => stream.setWindowVisible(win.isVisible() && !win.isMinimized());
  ['minimize', 'restore', 'show', 'hide'].forEach((eventName) => win.on(eventName, syncVisibility));

  // Con transmision activa, confirmar antes de cerrar (cortaria sin outro).
  let forceClose = false;
  win.on('close', (event) => {
    if (forceClose || !stream.isStreaming()) return;

    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
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
      stream.shutdown();
      win.close();
    }
  });

  return win;
}

module.exports = { createMainWindow };
