const { VU_EMIT_INTERVAL_MS, HIDDEN_CHECK_INTERVAL_MS } = require('./constants');
const { asInt16 } = require('../audio/pcm');
const { peakOf, computeMetrics, computeSpectrum } = require('../audio/dsp');
const { checkDeadAir } = require('./dead-air');
const uiVisibility = require('./ui-visibility');
const { sendAudioMetrics } = require('../../ipc/events');

function createLiveMetricsState() {
  return { lastEmit: 0, lastCheck: 0, windowPeak: 0 };
}

/**
 * Procesa un bloque de audio en vivo (ya con ganancia). El pico de TODOS los
 * bloques alimenta la deteccion de aire muerto; el vumetro/espectro completos
 * solo se calculan (y envian por IPC) si la interfaz los esta mostrando.
 */
function pushLiveChunk(session, chunk, now) {
  const m = session.metrics;
  const samples = asInt16(chunk);

  const peak = peakOf(samples);
  if (peak > m.windowPeak) m.windowPeak = peak;

  if (uiVisibility.isMetricsWanted()) {
    if (now - m.lastEmit < VU_EMIT_INTERVAL_MS) return;
    m.lastEmit = now;
    m.lastCheck = now;
    sendAudioMetrics(session.mainWindow, computeMetrics(samples), computeSpectrum(samples));
    checkDeadAir(session, m.windowPeak, now);
    m.windowPeak = 0;
    return;
  }

  if (now - m.lastCheck >= HIDDEN_CHECK_INTERVAL_MS) {
    m.lastCheck = now;
    checkDeadAir(session, m.windowPeak, now);
    m.windowPeak = 0;
  }
}

module.exports = { createLiveMetricsState, pushLiveChunk };
