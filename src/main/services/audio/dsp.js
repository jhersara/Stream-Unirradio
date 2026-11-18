'use strict';
/**
 * DSP de audio compartido (PCM s16le entrelazado). Todo opera sobre vistas
 * Int16Array y tablas precalculadas: sin asignaciones por llamada, de modo que
 * el calculo del vumetro y del espectro cuesta microsegundos y puede correr
 * directamente en el proceso principal (sin worker thread).
 */

const FFT_SIZE = 512;
const HALF = FFT_SIZE / 2;
const BAND_COUNT = 24;

function normalizedToDb(value) {
  return value > 0 ? 20 * Math.log10(Math.min(1, value)) : -100;
}

// ---- Tablas precalculadas -------------------------------------------------
const BIT_REVERSE = new Uint16Array(FFT_SIZE);
const TWIDDLE_COS = new Float32Array(HALF);
const TWIDDLE_SIN = new Float32Array(HALF);
const HANN_FULL = new Float32Array(FFT_SIZE);
const BAND_START = new Uint16Array(BAND_COUNT);
const BAND_END = new Uint16Array(BAND_COUNT);

(function buildTables() {
  const bits = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) {
    let reversed = 0;
    for (let b = 0; b < bits; b += 1) if (i & (1 << b)) reversed |= 1 << (bits - 1 - b);
    BIT_REVERSE[i] = reversed;
    HANN_FULL[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  }
  for (let k = 0; k < HALF; k += 1) {
    const angle = (-2 * Math.PI * k) / FFT_SIZE;
    TWIDDLE_COS[k] = Math.cos(angle);
    TWIDDLE_SIN[k] = Math.sin(angle);
  }
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const start = Math.max(1, Math.floor(Math.pow(HALF, band / BAND_COUNT)));
    const end = Math.max(start + 1, Math.floor(Math.pow(HALF, (band + 1) / BAND_COUNT)));
    BAND_START[band] = start;
    BAND_END[band] = Math.min(end, HALF);
  }
}());

// Buffers de trabajo reutilizados (el uso es sincrono y no reentrante).
const RE = new Float32Array(FFT_SIZE);
const IM = new Float32Array(FFT_SIZE);

function fftInPlace() {
  for (let i = 0; i < FFT_SIZE; i += 1) {
    const j = BIT_REVERSE[i];
    if (i < j) {
      let tmp = RE[i]; RE[i] = RE[j]; RE[j] = tmp;
      tmp = IM[i]; IM[i] = IM[j]; IM[j] = tmp;
    }
  }
  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const half = len >> 1;
    const step = FFT_SIZE / len;
    for (let i = 0; i < FFT_SIZE; i += len) {
      for (let j = 0, k = 0; j < half; j += 1, k += step) {
        const wr = TWIDDLE_COS[k];
        const wi = TWIDDLE_SIN[k];
        const a = i + j;
        const b = a + half;
        const vr = RE[b] * wr - IM[b] * wi;
        const vi = RE[b] * wi + IM[b] * wr;
        RE[b] = RE[a] - vr;
        IM[b] = IM[a] - vi;
        RE[a] += vr;
        IM[a] += vi;
      }
    }
  }
}

/** Pico normalizado (0..1) de todo el bloque. */
function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
  }
  return peak / 32768;
}

/** Metricas estereo (L/R entrelazados): pico, RMS, nivel por canal y clip. */
function computeMetrics(samples) {
  let peakLeft = 0;
  let peakRight = 0;
  let sumLeft = 0;
  let sumRight = 0;
  const frames = samples.length >> 1;

  for (let i = 0, n = frames * 2; i < n; i += 2) {
    const left = samples[i];
    const right = samples[i + 1];
    const absLeft = left < 0 ? -left : left;
    const absRight = right < 0 ? -right : right;
    if (absLeft > peakLeft) peakLeft = absLeft;
    if (absRight > peakRight) peakRight = absRight;
    sumLeft += left * left;
    sumRight += right * right;
  }

  const leftPeak = peakLeft / 32768;
  const rightPeak = peakRight / 32768;
  const peak = Math.max(leftPeak, rightPeak);
  const rms = frames > 0 ? Math.sqrt((sumLeft + sumRight) / (frames * 2)) / 32768 : 0;
  const peakDb = normalizedToDb(peak);

  return {
    peak,
    db: peakDb,
    peakDb,
    rms,
    rmsDb: normalizedToDb(rms),
    leftDb: normalizedToDb(leftPeak),
    rightDb: normalizedToDb(rightPeak),
    clip: peak >= 0.98
  };
}

/** Pico/RMS tratando todas las muestras como un unico canal. */
function computeSimpleLevels(samples) {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
    sum += s * s;
  }
  const peakNormalized = peak / 32768;
  const rms = samples.length > 0 ? Math.sqrt(sum / samples.length) / 32768 : 0;
  return { peak: peakNormalized, db: normalizedToDb(peakNormalized), rmsDb: normalizedToDb(rms) };
}

/** Espectro en BAND_COUNT bandas logaritmicas (0..1) a partir de una ventana mono. */
function computeSpectrum(samples) {
  const frames = samples.length >> 1;
  const sampleCount = Math.min(FFT_SIZE, frames);
  RE.fill(0);
  IM.fill(0);

  const useFullWindow = sampleCount === FFT_SIZE;
  for (let i = 0; i < sampleCount; i += 1) {
    const window = useFullWindow
      ? HANN_FULL[i]
      : (sampleCount > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (sampleCount - 1)) : 1);
    RE[i] = ((samples[i * 2] + samples[i * 2 + 1]) / 2 / 32768) * window;
  }

  fftInPlace();

  const bands = new Array(BAND_COUNT);
  for (let band = 0; band < BAND_COUNT; band += 1) {
    let sum = 0;
    const start = BAND_START[band];
    const end = BAND_END[band];
    for (let i = start; i < end; i += 1) sum += Math.sqrt(RE[i] * RE[i] + IM[i] * IM[i]);
    const count = end - start;
    const average = count > 0 ? sum / count : 0;
    bands[band] = Math.min(1, Math.sqrt(average) * 2.2);
  }
  return bands;
}

module.exports = {
  BAND_COUNT,
  normalizedToDb,
  peakOf,
  computeMetrics,
  computeSimpleLevels,
  computeSpectrum
};
