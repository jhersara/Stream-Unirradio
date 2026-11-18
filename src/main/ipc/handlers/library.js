const { ipcMain, dialog } = require('electron');
const libraryManager = require('../../services/media/library');
const { pathExists } = require('../../utils/fs');
const { sendLog } = require('../events');

/** Biblioteca persistente de pistas (intro/outro/podcast). */
function registerLibraryHandlers(getWindow) {
  ipcMain.handle('library:list', () => libraryManager.listTracks());

  ipcMain.handle('library:import', async () => {
    const mainWindow = getWindow();
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

  ipcMain.handle('library:delete', (event, id) => libraryManager.deleteTrack(id));

  ipcMain.handle('library:get-audio-url', async (event, id) => {
    const trackPath = libraryManager.getTrackPath(id);
    const exists = trackPath ? await pathExists(trackPath) : false;
    return { url: exists ? `streamradio://track/${encodeURIComponent(String(id))}` : null };
  });

  ipcMain.handle('dialog:select-audio-file', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
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

module.exports = { registerLibraryHandlers };
