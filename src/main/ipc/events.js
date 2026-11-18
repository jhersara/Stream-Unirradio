/**
 * Emision de eventos hacia el renderer. Los nombres de canal viven solo aqui.
 */
function send(mainWindow, channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

const sendLog = (win, message) => send(win, 'stream:log', { timestamp: new Date().toISOString(), message });
const sendStatus = (win, kind, elapsedSeconds) => send(win, 'stream:status', { kind, elapsedSeconds });
const sendPreviewVuLevel = (win, peak, db) => send(win, 'stream:preview-vu-level', { peak, db });
const sendDeadAir = (win, active) => send(win, 'stream:dead-air', { active });
const sendIntroProgress = (win, payload) => send(win, 'stream:intro-progress', payload);
const sendOutroProgress = (win, payload) => send(win, 'stream:outro-progress', payload);
const sendUpdateState = (win, payload) => send(win, 'app:update-state', payload);
const sendPodcastExportProgress = (win, payload) => send(win, 'podcast:export-progress', payload);
const sendPodcastRecordingState = (win, payload) => send(win, 'podcast:recording-state', payload);
const sendPodcastRecordingLevel = (win, payload) => send(win, 'podcast:recording-level', payload);
const sendRecordingSaveState = (win, payload) => send(win, 'recording:save-state', payload);

/** Vumetro y espectro viajan juntos: un solo mensaje IPC por actualizacion. */
function sendAudioMetrics(win, metrics, bands) {
  send(win, 'stream:audio-metrics', {
    vu: {
      peak: metrics.peak,
      db: metrics.db,
      peakDb: metrics.peakDb,
      rms: metrics.rms,
      rmsDb: metrics.rmsDb,
      leftDb: metrics.leftDb,
      rightDb: metrics.rightDb,
      clip: Boolean(metrics.clip)
    },
    bands
  });
}

module.exports = {
  sendLog,
  sendStatus,
  sendAudioMetrics,
  sendPreviewVuLevel,
  sendDeadAir,
  sendIntroProgress,
  sendOutroProgress,
  sendUpdateState,
  sendPodcastExportProgress,
  sendPodcastRecordingState,
  sendPodcastRecordingLevel,
  sendRecordingSaveState
};
