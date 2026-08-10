/**
 * Helpers centralizados para emitir eventos hacia el renderer. Tener los
 * nombres de canal en un solo lugar evita typos entre ipc-handlers.js y
 * ffmpeg-stream.js.
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

function sendIntroProgress(mainWindow, payload) {
  send(mainWindow, 'stream:intro-progress', payload);
}

function sendOutroProgress(mainWindow, payload) {
  send(mainWindow, 'stream:outro-progress', payload);
}

module.exports = {
  sendLog,
  sendStatus,
  sendVuLevel,
  sendIntroProgress,
  sendOutroProgress
};
