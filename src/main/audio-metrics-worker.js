const { parentPort } = require('worker_threads');

const FFT_SIZE = 512;
const BAND_COUNT = 24;

function normalizedToDb(value) {
  return value > 0 ? 20 * Math.log10(Math.min(1, value)) : -100;
}

function readInt16LE(bytes, offset) {
  const value = bytes[offset] | (bytes[offset + 1] << 8);
  return value & 0x8000 ? value - 0x10000 : value;
}

function computeAudioMetrics(bytes) {
  let peakLeft = 0;
  let peakRight = 0;
  let sumSquaresLeft = 0;
  let sumSquaresRight = 0;
  let frames = 0;

  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const left = readInt16LE(bytes, i);
    const right = readInt16LE(bytes, i + 2);
    const absLeft = Math.abs(left);
    const absRight = Math.abs(right);
    if (absLeft > peakLeft) peakLeft = absLeft;
    if (absRight > peakRight) peakRight = absRight;
    sumSquaresLeft += left * left;
    sumSquaresRight += right * right;
    frames += 1;
  }

  const leftPeak = peakLeft / 32768;
  const rightPeak = peakRight / 32768;
  const peak = Math.max(leftPeak, rightPeak);
  const rms = frames > 0
    ? Math.sqrt((sumSquaresLeft + sumSquaresRight) / (frames * 2)) / 32768
    : 0;

  return {
    peak,
    db: normalizedToDb(peak),
    peakDb: normalizedToDb(peak),
    rms,
    rmsDb: normalizedToDb(rms),
    leftDb: normalizedToDb(leftPeak),
    rightDb: normalizedToDb(rightPeak),
    clip: peak >= 0.98
  };
}

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len / 2;
      for (let j = 0; j < half; j += 1) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
        const vIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

function computeSpectrum(bytes) {
  const availableFrames = Math.floor(bytes.length / 4);
  const sampleCount = Math.min(FFT_SIZE, availableFrames);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  for (let i = 0; i < sampleCount; i += 1) {
    const left = readInt16LE(bytes, i * 4);
    const right = readInt16LE(bytes, i * 4 + 2);
    const hann = sampleCount > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (sampleCount - 1)) : 1;
    re[i] = ((left + right) / 2 / 32768) * hann;
  }

  fftInPlace(re, im);
  const bins = FFT_SIZE / 2;
  const bands = new Array(BAND_COUNT).fill(0);
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const startBin = Math.max(1, Math.floor(Math.pow(bins, band / BAND_COUNT)));
    const endBin = Math.max(startBin + 1, Math.floor(Math.pow(bins, (band + 1) / BAND_COUNT)));
    let sum = 0;
    let count = 0;
    for (let i = startBin; i < Math.min(endBin, bins); i += 1) {
      sum += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      count += 1;
    }
    const average = count > 0 ? sum / count : 0;
    bands[band] = Math.min(1, Math.sqrt(average) * 2.2);
  }
  return bands;
}

parentPort.on('message', ({ id, buffer }) => {
  try {
    const bytes = new Uint8Array(buffer);
    parentPort.postMessage({ id, metrics: computeAudioMetrics(bytes), spectrum: computeSpectrum(bytes) });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
