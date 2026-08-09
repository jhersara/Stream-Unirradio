const { ipcMain, dialog } = require('electron');

/**
 * Registra los canales IPC expuestos al renderer a través de preload.js.
 *
 * Los handlers de streaming (stream:start / stream:stop / devices:list) son
 * stubs por ahora: el motor real (ffmpeg-stream.js, audio-capture.js,
 * media-probe.js) se implementa en la Fase 2 del README. Este archivo ya
 * deja la forma final de la API para que el renderer (Fase 3) se pueda
 * construir en paralelo contra esta interfaz sin esperar al motor completo.
 */
function registerIpcHandlers(mainWindow) {
  ipcMain.handle('stream:start', async (event, config) => {
    // TODO (Fase 2): construir comando ffmpeg, iniciar captura con naudiodon,
    // reproducir intro emitiendo 'stream:intro-progress', luego pasar a audio
    // en vivo emitiendo 'stream:vu-level'.
    sendLog(mainWindow, 'Motor de streaming aun no implementado (Fase 2 pendiente).');
    return { ok: false, reason: 'not-implemented' };
  });

  ipcMain.handle('stream:stop', async () => {
    // TODO (Fase 2): reproducir outro emitiendo 'stream:outro-progress' y
    // cortar la conexion real a Icecast 2 segundos antes de que el outro
    // termine (ver "Especificaciones funcionales confirmadas" en README).
    sendLog(mainWindow, 'Detener aun no implementado (Fase 2 pendiente).');
    return { ok: false, reason: 'not-implemented' };
  });

  ipcMain.handle('devices:list', async () => {
    // TODO (Fase 2): listar dispositivos de entrada reales con naudiodon.
    return [];
  });

  ipcMain.handle('dialog:select-audio-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar archivo de audio',
      properties: ['openFile'],
      filters: [
        { name: 'Archivos de audio', extensions: ['mp3', 'wav', 'aac', 'flac'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}

function sendLog(mainWindow, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stream:log', {
      timestamp: new Date().toISOString(),
      message
    });
  }
}

module.exports = { registerIpcHandlers };
