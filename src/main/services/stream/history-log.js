const historyStore = require('../../stores/history');

/** Registra una sesion terminada en el historial (nunca debe romper nada mas). */
function logHistoryEntry(finishedSession, endReason) {
  if (!finishedSession || !finishedSession.startedAt) return;
  try {
    historyStore.addSession({
      startedAt: new Date(finishedSession.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: (Date.now() - finishedSession.startedAt) / 1000,
      server: finishedSession.config.server,
      mount: finishedSession.config.mount,
      recordingPath: finishedSession.recordingPath || null,
      endReason
    });
  } catch { /* noop */ }
}

module.exports = { logHistoryEntry };
