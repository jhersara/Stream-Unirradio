/**
 * Helpers centralizados para emitir eventos hacia el renderer. Tener los
 * nombres de canal en un solo lugar evita typos entre ipc-handlers.js,
 * ffmpeg-stream.js y auto-updater.js.
 */
function send(mainWindow, channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendLog(mainWindow, message) {
  send(mainWindow, 'stream:log', { timestamp: new Date().toISOString(), message });
}

function sendStatus(mainWindow, kind, elapsedSeconds) {
  send(mainWindow, 'stream:status', { kind, elapsedSeconds });
}

function sendVuLevel(mainWindow, peak, db) {
  send(mainWindow, 'stream:vu-level', { peak, db });
}

function sendPreviewVuLevel(mainWindow, peak, db) {
  send(mainWindow, 'stream:preview-vu-level', { peak, db });
}

function sendSpectrum(mainWindow, bands) {
  send(mainWindow, 'stream:spectrum', { bands });
}

function sendIntroProgress(mainWindow, payload) {
  send(mainWindow, 'stream:intro-progress', payload);
}

function sendOutroProgress(mainWindow, payload) {
  send(mainWindow, 'stream:outro-progress', payload);
}

/** payload: { state: 'checking'|'available'|'not-available'|'downloaded'|'error', version } */
function sendUpdateState(mainWindow, payload) {
  send(mainWindow, 'app:update-state', payload);
}

module.exports = {
  sendLog,
  sendStatus,
  sendVuLevel,
  sendPreviewVuLevel,
  sendSpectrum,
  sendIntroProgress,
  sendOutroProgress,
  sendUpdateState
};
