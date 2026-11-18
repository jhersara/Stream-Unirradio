const { spawn } = require('child_process');
const { resolveFfmpegPath } = require('../media/probe');
const { SAMPLE_RATE, CHANNELS, BYTES_PER_SECOND, CHUNK_MS } = require('./constants');

/**
 * Decodifica un archivo de audio a PCM s16le crudo en memoria, para poder
 * reproducirlo con ritmo controlado (intro/outro).
 */
function decodeToPcm(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-threads', '1',
      '-i', filePath,
      '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
      'pipe:1'
    ];
    let proc;
    try {
      proc = spawn(resolveFfmpegPath(), args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    const chunks = [];
    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.on('error', reject);
    proc.on('close', () => {
      if (chunks.length === 0) {
        reject(new Error('No se pudo decodificar el archivo de audio (revisa que ffmpeg.exe este disponible).'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Reproduce un buffer PCM a ritmo real (no "lo mas rapido posible"), en
 * trozos de CHUNK_MS. Asi la barra de progreso refleja el tiempo real y el
 * corte 2 s antes del final del outro es preciso.
 *
 * Devuelve { promise, abort }. La promise resuelve con:
 *   { cutoff: true }                  -> se alcanzo cutoffSeconds
 *   { cutoff: false, aborted: true }  -> abortado desde fuera
 *   { cutoff: false, aborted: false } -> buffer completo reproducido
 */
function playTimedPcm(buffer, { onChunk, onProgress, cutoffSeconds }) {
  const durationSeconds = buffer.length / BYTES_PER_SECOND;
  let cursor = 0;
  let stopped = false;
  let timeoutHandle = null;
  let finish = null;
  const startTime = Date.now();

  const promise = new Promise((resolve) => {
    finish = resolve;
    function tick() {
      if (stopped) {
        resolve({ cutoff: false, aborted: true });
        return;
      }

      const elapsedReal = (Date.now() - startTime) / 1000;
      if (cutoffSeconds != null && elapsedReal >= cutoffSeconds) {
        resolve({ cutoff: true, aborted: false });
        return;
      }

      let targetBytes = Math.floor((elapsedReal * BYTES_PER_SECOND) / 4) * 4;
      targetBytes = Math.min(targetBytes, buffer.length);
      if (cutoffSeconds != null) {
        targetBytes = Math.min(targetBytes, Math.floor((cutoffSeconds * BYTES_PER_SECOND) / 4) * 4);
      }

      if (targetBytes > cursor) {
        onChunk(buffer.subarray(cursor, targetBytes));
        cursor = targetBytes;
        onProgress(cursor / BYTES_PER_SECOND, durationSeconds);
      }

      if (cursor >= buffer.length) {
        resolve({ cutoff: false, aborted: false });
        return;
      }
      timeoutHandle = setTimeout(tick, CHUNK_MS);
    }
    tick();
  });

  function abort() {
    stopped = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    // Resuelve de inmediato: antes la promesa quedaba colgada para siempre.
    if (finish) finish({ cutoff: false, aborted: true });
  }

  return { promise, abort };
}

module.exports = { decodeToPcm, playTimedPcm };
