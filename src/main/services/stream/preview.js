const state = require('./state');
const { SAMPLE_RATE, CHANNELS, VU_EMIT_INTERVAL_MS } = require('./constants');
const audioCapture = require('../audio/capture');
const { asInt16 } = require('../audio/pcm');
const { computeMetrics } = require('../audio/dsp');
const { sendLog, sendPreviewVuLevel } = require('../../ipc/events');

/**
 * Prueba de microfono (fuera de una transmision): solo escucha y envia el
 * nivel; no conecta ni escribe en ningun lado.
 */
function startPreview(mainWindow, deviceId) {
  if (state.session) return { ok: false, reason: 'streaming-active' };
  if (state.previewState) stopPreview();
  if (!audioCapture.isAvailable()) {
    sendLog(mainWindow, 'ERROR: el modulo de captura de audio (naudiodon) no esta disponible.');
    return { ok: false, reason: 'naudiodon-unavailable' };
  }

  let inputStream;
  try {
    inputStream = audioCapture.createInputStream(deviceId, SAMPLE_RATE, CHANNELS);
  } catch (err) {
    sendLog(mainWindow, `ERROR probando microfono: ${err.message}`);
    return { ok: false, reason: 'device-error' };
  }

  state.previewState = { inputStream };
  let lastEmit = 0;

  inputStream.on('data', (chunk) => {
    if (!state.previewState) return;
    const now = Date.now();
    if (now - lastEmit < VU_EMIT_INTERVAL_MS) return;
    lastEmit = now;
    const { peak, db } = computeMetrics(asInt16(chunk));
    sendPreviewVuLevel(mainWindow, peak, db);
  });
  inputStream.on('error', (err) => {
    sendLog(mainWindow, `ERROR probando microfono: ${err.message}`);
  });
  inputStream.start();

  return { ok: true };
}

function stopPreview() {
  if (!state.previewState) return { ok: true };
  const { inputStream } = state.previewState;
  state.previewState = null;
  audioCapture.releaseInputStream(inputStream);
  return { ok: true };
}

function isPreviewing() {
  return state.previewState !== null;
}

module.exports = { startPreview, stopPreview, isPreviewing };
