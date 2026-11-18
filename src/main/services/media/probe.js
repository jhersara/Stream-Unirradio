const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DEV_FFMPEG_PATH } = require('../../utils/paths');
const { createLimiter } = require('../../utils/limiter');

let cachedFfmpegPath = null;

/**
 * Ruta al ffmpeg embebido (resources/ffmpeg en dev, process.resourcesPath
 * empaquetado). Cae a "ffmpeg" del PATH como ultimo recurso. Se resuelve una
 * sola vez.
 */
function resolveFfmpegPath() {
  if (cachedFfmpegPath) return cachedFfmpegPath;
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
    : DEV_FFMPEG_PATH;
  cachedFfmpegPath = fs.existsSync(candidate) ? candidate : 'ffmpeg';
  return cachedFfmpegPath;
}

// Como mucho dos procesos ffmpeg de analisis a la vez.
const runProbe = createLimiter(2);

/** Duracion en segundos leyendo "Duration:" de stderr de `ffmpeg -i`. */
function getDurationSeconds(filePath) {
  return runProbe(() => new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(resolveFfmpegPath(), ['-hide_banner', '-i', filePath], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }

    let stderrData = '';
    proc.stderr.on('data', (chunk) => { stderrData += chunk.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const match = stderrData.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) {
        resolve(null);
        return;
      }
      resolve(parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]));
    });
  }));
}

// Cache de formas de onda: cada render del timeline las pedia de nuevo y cada
// peticion lanzaba un ffmpeg. La clave incluye mtime y tamano del archivo.
const WAVEFORM_CACHE_LIMIT = 64;
const waveformCache = new Map();

function renderWaveform(filePath, width, height) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(resolveFfmpegPath(), [
        '-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', filePath,
        '-filter_complex', `showwavespic=s=${width}x${height}:colors=0x38d9ff:scale=sqrt`,
        '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'
      ], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }

    const chunks = [];
    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        resolve(null);
        return;
      }
      resolve(`data:image/png;base64,${Buffer.concat(chunks).toString('base64')}`);
    });
  });
}

async function getWaveformData(filePath, width = 960, height = 160) {
  let key;
  try {
    const stat = await fs.promises.stat(filePath);
    key = `${filePath}|${stat.mtimeMs}|${stat.size}|${width}x${height}`;
  } catch {
    return null;
  }

  if (waveformCache.has(key)) {
    const cached = waveformCache.get(key);
    waveformCache.delete(key);
    waveformCache.set(key, cached);
    return cached;
  }

  const dataUrl = await runProbe(() => renderWaveform(filePath, width, height));
  if (dataUrl) {
    waveformCache.set(key, dataUrl);
    if (waveformCache.size > WAVEFORM_CACHE_LIMIT) {
      waveformCache.delete(waveformCache.keys().next().value);
    }
  }
  return dataUrl;
}

module.exports = { getDurationSeconds, getWaveformData, resolveFfmpegPath };
