const { ipcMain, dialog, app, shell } = require('electron');
const path = require('path');
const libraryManager = require('../../services/media/library');
const podcastStore = require('../../stores/podcast');
const podcastExporter = require('../../services/podcast/exporter');
const podcastRecorder = require('../../services/podcast/recorder');
const { measureEpisode } = require('../../services/podcast/metrics');
const { getWaveformData } = require('../../services/media/probe');
const mediaPreviewStore = require('../../services/media/preview-store');
const { pathExists } = require('../../utils/fs');
const { sendLog } = require('../events');

/** Solo se aceptan pistas de la biblioteca o tomas dentro de userData/podcast-studio/recordings. */
function getSegmentPath(segment) {
  if (segment?.type !== 'recording') return libraryManager.getTrackPath(segment?.sourceId);
  const recordingRoot = path.resolve(podcastStore.getRecordingsRoot());
  const filePath = path.resolve(String(segment.sourceId || ''));
  return filePath === recordingRoot || filePath.startsWith(`${recordingRoot}${path.sep}`) ? filePath : null;
}

function registerPodcastHandlers(getWindow) {
  ipcMain.handle('podcast:list', () => podcastStore.listEpisodes());
  ipcMain.handle('podcast:create', (event, input) => podcastStore.createEpisode(input || {}));
  ipcMain.handle('podcast:update', (event, id, patch) => podcastStore.updateEpisode(id, patch || {}));
  ipcMain.handle('podcast:delete', (event, id) => ({ ok: podcastStore.deleteEpisode(id) }));

  ipcMain.handle('podcast:export', async (event, id) => {
    const mainWindow = getWindow();
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

  ipcMain.handle('podcast:reveal-export', (event, filePath) => {
    if (filePath) shell.showItemInFolder(filePath);
    return { ok: true };
  });
  ipcMain.handle('podcast:export-cancel', () => podcastExporter.cancelExport());
  ipcMain.handle('podcast:export-status', () => ({ exporting: podcastExporter.isExporting() }));

  ipcMain.handle('podcast:record-start', (event, deviceId) => podcastRecorder.start(getWindow(), deviceId));
  ipcMain.handle('podcast:record-stop', () => podcastRecorder.stop(getWindow()));
  ipcMain.handle('podcast:record-status', () => ({ recording: podcastRecorder.isRecording() }));

  ipcMain.handle('podcast:waveform', async (event, segment) => {
    const filePath = getSegmentPath(segment);
    if (!filePath || !(await pathExists(filePath))) return { ok: false, dataUrl: null };
    const dataUrl = await getWaveformData(filePath);
    return { ok: Boolean(dataUrl), dataUrl };
  });

  ipcMain.handle('podcast:segment-audio-url', async (event, segment) => {
    const filePath = getSegmentPath(segment);
    if (!filePath || !(await pathExists(filePath))) return { ok: false, url: null };
    const token = mediaPreviewStore.register(filePath);
    return { ok: true, url: `streamradio://podcast/${encodeURIComponent(token)}` };
  });

  ipcMain.handle('podcast:metrics', (event, episode) => measureEpisode(episode || {}));
}

module.exports = { registerPodcastHandlers };
