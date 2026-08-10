const { ipcMain, dialog, app } = require('electron');
const libraryManager = require('./library-manager');
const ffmpegStream = require('./ffmpeg-stream');
const audioCapture = require('./audio-capture');
const settingsStore = require('./settings-store');
const { sendLog } = require('./ipc-events');

/**
 * Registra los canales IPC expuestos al renderer a traves de preload.js.
 *
 * Streaming (stream:start / stream:stop / stream:set-gain / devices:list) ya
 * esta implementado de verdad (Fase 2, ver ffmpeg-stream.js + audio-capture.js).
 * La biblioteca de intro/outro (Fase 3) tambien esta implementada.
 */
function registerIpcHandlers(mainWindow) {
  // ---------------------------------------------------------------------
  // Streaming (Fase 2 - implementado)
  // ---------------------------------------------------------------------
  ipcMain.handle('stream:start', async (event, config) => {
    return ffmpegStream.startStream(mainWindow, config);
  });

  ipcMain.handle('stream:stop', async () => {
    return ffmpegStream.stopStream(mainWindow);
  });

  ipcMain.handle('stream:set-gain', async (event, value) => {
    ffmpegStream.setGain(Number(value));
    return { ok: true };
  });

  ipcMain.handle('devices:list', async () => {
    if (!audioCapture.isAvailable()) {
      const err = audioCapture.getLoadError();
      sendLog(
        mainWindow,
        `Aviso: no se pudo cargar el modulo de audio (naudiodon)${err ? ': ' + err.message : ''}. Revisa la Fase 1.5 del README.`
      );
      return [];
    }
    return audioCapture.listInputDevices();
  });

  // ---------------------------------------------------------------------
  // Info de la app (vista "Informacion")
  // ---------------------------------------------------------------------
  ipcMain.handle('app:info', async () => ({
    name: app.getName(),
    version: app.getVersion()
  }));

  // ---------------------------------------------------------------------
  // Biblioteca de intro/outro (Fase 3 - implementado)
  // ---------------------------------------------------------------------
  ipcMain.handle('library:list', async () => {
    return libraryManager.listTracks();
  });

  ipcMain.handle('library:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar pistas de audio',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Archivos de audio', extensions: ['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { imported: 0, library: libraryManager.listTracks() };
    }
    try {
      const library = await libraryManager.importTracks(result.filePaths);
      sendLog(mainWindow, `${result.filePaths.length} pista(s) importada(s) a la biblioteca.`);
      return { imported: result.filePaths.length, library };
    } catch (err) {
      sendLog(mainWindow, `ERROR importando pistas: ${err.message}`);
      return { imported: 0, library: libraryManager.listTracks() };
    }
  });

  ipcMain.handle('library:delete', async (event, id) => {
    return libraryManager.deleteTrack(id);
  });

  // ---------------------------------------------------------------------
  // Configuracion persistida (servidor, credenciales, pistas activas)
  // ---------------------------------------------------------------------
  ipcMain.handle('settings:load', async () => {
    return settingsStore.loadSettings();
  });

  ipcMain.handle('settings:save', async (event, settings) => {
    settingsStore.saveSettings(settings);
    return { ok: true };
  });

  // ---------------------------------------------------------------------
  // Dialogo generico (usado por vistas que aun no tienen flujo propio)
  // ---------------------------------------------------------------------
  ipcMain.handle('dialog:select-audio-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
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

module.exports = { registerIpcHandlers };
