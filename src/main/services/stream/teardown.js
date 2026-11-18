const state = require('./state');
const { stopStatusTicker } = require('./status');
const { logHistoryEntry } = require('./history-log');
const { finalizeLocalRecording } = require('./local-recording');
const { releaseInputStream } = require('../audio/capture');
const { gracefullyEndProcess, killQuietly } = require('../../utils/process');
const { sendLog, sendStatus, sendDeadAir, sendIntroProgress, sendOutroProgress, sendRecordingSaveState } = require('../../ipc/events');

/** Corte inesperado (reconexion agotada, error de configuracion, etc.). */
function handleUnexpectedTermination(mainWindow) {
  const session = state.session;
  if (!session) return;
  session.introController?.abort();
  session.outroController?.abort();
  if (session.inputStream) {
    try { session.inputStream.quit(() => {}); } catch { /* noop */ }
  }
  if (session.recorderProcess) killQuietly(session.recorderProcess);
  if (session.sourceBridge) {
    session.sourceBridge.close();
    session.sourceBridge = null;
  }
  stopStatusTicker();
  state.session = null;
  logHistoryEntry(session, 'error');
  sendIntroProgress(mainWindow, { done: true });
  sendOutroProgress(mainWindow, { done: true });
  sendDeadAir(mainWindow, false);
  sendStatus(mainWindow, 'error', 0);
}

/** Cierre ordenado de la sesion actual (el encoder tiene prioridad). */
async function teardownSession(mainWindow, finalStatusKind) {
  stopStatusTicker();
  const finishedSession = state.session;
  state.session = null;
  if (finishedSession?.sourceBridge) finishedSession.sourceBridge.close();

  const recordingActive = Boolean(finishedSession?.recordingRequested && finishedSession.recordingTempPath);
  if (recordingActive) {
    sendRecordingSaveState(mainWindow, { state: 'processing', message: 'La transmisión terminó; finalizando la grabación en segundo plano…' });
  }

  await gracefullyEndProcess(finishedSession ? finishedSession.encoderProcess : null, 1800);

  sendDeadAir(mainWindow, false);
  sendStatus(mainWindow, finalStatusKind, 0);
  sendLog(mainWindow, 'Transmisión finalizada. Desconectado del servidor.');

  if (recordingActive) {
    finalizeLocalRecording(mainWindow, finishedSession);
  } else {
    logHistoryEntry(finishedSession, 'manual');
  }
}

/** Libera el dispositivo de captura de una sesion y limpia su referencia. */
function releaseSessionInput(session) {
  if (session.inputStream) {
    releaseInputStream(session.inputStream);
    session.inputStream = null;
  }
}

module.exports = { handleUnexpectedTermination, teardownSession, releaseSessionInput };
