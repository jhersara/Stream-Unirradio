const { ipcMain, dialog, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const libraryManager = require('./library-manager');
const podcastStore = require('./podcast-store');
const podcastExporter = require('./podcast-exporter');
const podcastRecorder = require('./podcast-recorder');
const { getWaveformData } = require('./media-probe');
const { measureEpisode } = require('./podcast-metrics');
const ffmpegStream = require('./ffmpeg-stream');
const audioCapture = require('./audio-capture');
const settingsStore = require('./settings-store');
const radioProviders = require('./radio-providers');
const autoUpdaterModule = require('./auto-updater');
const historyStore = require('./history-store');
const scheduleStore = require('./schedule-store');
const { sendLog } = require('./ipc-events');
const mediaPreviewStore = require('./media-preview-store');

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

  ipcMain.handle('stream:toggle-pause', async () => {
    return ffmpegStream.togglePauseStream(mainWindow);
  });

  ipcMain.handle('stream:set-gain', async (event, value) => {
    ffmpegStream.setGain(Number(value));
    return { ok: true };
  });

  ipcMain.handle('stream:preview-start', async (event, deviceId) => {
    return ffmpegStream.startPreview(mainWindow, deviceId);
  });

  ipcMain.handle('stream:preview-stop', async () => {
    return ffmpegStream.stopPreview();
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

  ipcMain.handle('library:get-audio-url', async (event, id) => {
    const trackPath = libraryManager.getTrackPath(id);
    return {
      url: trackPath && fs.existsSync(trackPath)
        ? `streamradio://track/${encodeURIComponent(String(id))}`
        : null
    };
  });

  // ---------------------------------------------------------------------
  // Podcast Studio
  // ---------------------------------------------------------------------
  ipcMain.handle('podcast:list', async () => podcastStore.listEpisodes());

  ipcMain.handle('podcast:create', async (event, input) => podcastStore.createEpisode(input || {}));

  ipcMain.handle('podcast:update', async (event, id, patch) => podcastStore.updateEpisode(id, patch || {}));

  ipcMain.handle('podcast:delete', async (event, id) => ({ ok: podcastStore.deleteEpisode(id) }));

  ipcMain.handle('podcast:export', async (event, id) => {
    const episode = podcastStore.getEpisode(id);
    if (!episode) return { ok: false, reason: 'episode-not-found' };

    const safeTitle = String(episode.title || 'episodio')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'episodio';
    const defaultPath = path.join(app.getPath('documents'), 'Stream Radio - Podcasts', `${safeTitle}.mp3`);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar episodio',
      defaultPath,
      buttonLabel: 'Exportar MP3',
      filters: [{ name: 'Podcast MP3', extensions: ['mp3'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };

    try {
      const exported = await podcastExporter.exportEpisode(mainWindow, episode, result.filePath);
      podcastStore.updateEpisode(id, {
        status: 'exported',
        exportPath: exported.outputPath,
        exportedAt: new Date().toISOString()
      });
      sendLog(mainWindow, `Episodio exportado: ${exported.outputPath}`);
      return { ok: true, ...exported };
    } catch (error) {
      if (error.code === 'EXPORT_CANCELLED') return { ok: false, reason: 'cancelled', message: error.message };
      if (error.code === 'EXPORT_BUSY') return { ok: false, reason: 'busy', message: error.message };
      sendLog(mainWindow, `ERROR exportando episodio: ${error.message}`);
      return { ok: false, reason: 'export-failed', message: error.message };
    }
  });

  ipcMain.handle('podcast:reveal-export', async (event, filePath) => {
    if (filePath) shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle('podcast:export-cancel', async () => podcastExporter.cancelExport());
  ipcMain.handle('podcast:export-status', async () => ({ exporting: podcastExporter.isExporting() }));

  ipcMain.handle('podcast:record-start', async (event, deviceId) => podcastRecorder.start(mainWindow, deviceId));

  ipcMain.handle('podcast:record-stop', async () => podcastRecorder.stop(mainWindow));

  ipcMain.handle('podcast:record-status', async () => ({ recording: podcastRecorder.isRecording() }));

  function getPodcastSegmentPath(segment) {
    if (segment?.type !== 'recording') return libraryManager.getTrackPath(segment?.sourceId);
    const recordingRoot = path.resolve(path.join(app.getPath('userData'), 'podcast-studio', 'recordings'));
    const filePath = path.resolve(String(segment.sourceId || ''));
    return filePath === recordingRoot || filePath.startsWith(`${recordingRoot}${path.sep}`) ? filePath : null;
  }

  ipcMain.handle('podcast:waveform', async (event, segment) => {
    const filePath = getPodcastSegmentPath(segment);
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, dataUrl: null };
    const dataUrl = await getWaveformData(filePath);
    return { ok: Boolean(dataUrl), dataUrl };
  });

  ipcMain.handle('podcast:segment-audio-url', async (event, segment) => {
    const filePath = getPodcastSegmentPath(segment);
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, url: null };
    const token = mediaPreviewStore.register(filePath);
    return { ok: true, url: `streamradio://podcast/${encodeURIComponent(token)}` };
  });

  ipcMain.handle('podcast:metrics', async (event, episode) => {
    return measureEpisode(episode || {});
  });

  // ---------------------------------------------------------------------
  // Configuracion persistida (servidor, credenciales, pistas activas)
  // ---------------------------------------------------------------------
  ipcMain.handle('settings:load', async () => {
    return settingsStore.loadSettings();
  });

  ipcMain.handle('providers:list', async () => radioProviders.listProviders());

  ipcMain.handle('settings:save', async (event, settings) => {
    settingsStore.saveSettings(settings);
    return { ok: true };
  });

  // ---------------------------------------------------------------------
  // Actualizaciones (boton manual en la vista "Informacion")
  // ---------------------------------------------------------------------
  ipcMain.handle('updates:check', async () => {
    autoUpdaterModule.checkNow(mainWindow);
    return { ok: true };
  });

  ipcMain.handle('updates:state', async () => autoUpdaterModule.getLastUpdateState());

  ipcMain.handle('updates:restart', async () => {
    autoUpdaterModule.restartToUpdate();
    return { ok: true };
  });

  // ---------------------------------------------------------------------
  // Historial de transmisiones
  // ---------------------------------------------------------------------
  ipcMain.handle('history:list', async () => {
    return historyStore.listSessions();
  });

  ipcMain.handle('history:reveal-recording', async (event, filePath) => {
    if (filePath) shell.showItemInFolder(filePath);
    return { ok: true };
  });

  // ---------------------------------------------------------------------
  // Programacion automatica (inicio/fin de transmision por horario)
  // ---------------------------------------------------------------------
  ipcMain.handle('schedule:load', async () => {
    return scheduleStore.loadSchedule();
  });

  ipcMain.handle('schedule:save', async (event, schedule) => {
    return scheduleStore.saveSchedule(schedule);
  });

  // ---------------------------------------------------------------------
  // Modo mini-ventana flotante (compacto, siempre-encima)
  // ---------------------------------------------------------------------
  let isCompact = false;
  let previousBounds = null;

  ipcMain.handle('window:set-compact', async (event, enabled) => {
    if (!mainWindow) return { compact: false };

    if (enabled && !isCompact) {
      previousBounds = mainWindow.getBounds();
      mainWindow.setMinimumSize(280, 120);
      mainWindow.setAlwaysOnTop(true, 'floating');
      mainWindow.setResizable(false);
      mainWindow.setBounds({
        x: previousBounds.x,
        y: previousBounds.y,
        width: 300,
        height: 130
      });
      isCompact = true;
    } else if (!enabled && isCompact) {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setResizable(true);
      mainWindow.setMinimumSize(640, 680);
      if (previousBounds) mainWindow.setBounds(previousBounds);
      isCompact = false;
    }

    return { compact: isCompact };
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
