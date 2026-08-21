const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');
const { resolveFfmpegPath } = require('./media-probe');
const audioCapture = require('./audio-capture');
const { sendLog, sendPodcastRecordingState, sendPodcastRecordingLevel } = require('./ipc-events');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
// Diez actualizaciones por segundo mantienen el medidor fluido con menor carga.
const VU_EMIT_INTERVAL_MS = 100;

let recording = null;

function getRecordingRoot() {
  const root = path.join(app.getPath('userData'), 'podcast-studio', 'recordings');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function buildRecordingPath() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return path.join(getRecordingRoot(), `voz-${stamp}.mp3`);
}

function buildArgs(outputPath) {
  return [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '192k',
    '-id3v2_version', '3',
    '-metadata', 'title=Grabación de voz · Stream Radio',
    '-metadata', 'comment=Voz grabada desde Podcast Studio',
    outputPath
  ];
}

function normalizedToDb(value) {
  return value > 0 ? 20 * Math.log10(Math.min(1, value)) : -100;
}

function computeMetrics(buffer) {
  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    const absolute = Math.abs(sample);
    if (absolute > peak) peak = absolute;
    sumSquares += sample * sample;
    samples += 1;
  }
  const peakNormalized = peak / 32768;
  const rms = samples > 0 ? Math.sqrt(sumSquares / samples) / 32768 : 0;
  return { peak: peakNormalized, db: normalizedToDb(peakNormalized), rmsDb: normalizedToDb(rms) };
}

function gracefullyCloseEncoder(process, timeoutMs = 3500) {
  return new Promise((resolve) => {
    if (!process || process.exitCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { process.kill(); } catch { /* noop */ }
      resolve();
    }, timeoutMs);
    process.once('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    try {
      if (process.stdin && !process.stdin.destroyed) process.stdin.end();
      else process.kill();
    } catch {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        try { process.kill(); } catch { /* noop */ }
        resolve();
      }
    }
  });
}

function start(mainWindow, deviceId) {
  if (recording) return { ok: false, reason: 'already-recording' };
  if (!audioCapture.isAvailable()) {
    sendLog(mainWindow, 'ERROR: no se puede grabar voz porque naudiodon no está disponible.');
    return { ok: false, reason: 'naudiodon-unavailable' };
  }

  const outputPath = buildRecordingPath();
  let encoderProcess;
  let inputStream;
  try {
    encoderProcess = spawn(resolveFfmpegPath(), buildArgs(outputPath), { windowsHide: true });
    inputStream = audioCapture.createInputStream(deviceId, SAMPLE_RATE, CHANNELS);
  } catch (error) {
    try { encoderProcess?.kill(); } catch { /* noop */ }
    sendLog(mainWindow, `ERROR iniciando grabación de voz: ${error.message}`);
    return { ok: false, reason: 'start-failed', message: error.message };
  }

  recording = {
    mainWindow,
    outputPath,
    encoderProcess,
    inputStream,
    startedAt: Date.now(),
    lastEmit: 0,
    stopRequested: false,
    closed: false
  };

  encoderProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) sendLog(mainWindow, `Grabación de voz: ${text}`);
  });
  encoderProcess.on('error', (error) => {
    if (!recording || recording.encoderProcess !== encoderProcess) return;
    sendLog(mainWindow, `ERROR en la grabación de voz: ${error.message}`);
  });
  encoderProcess.on('close', (code) => {
    if (!recording || recording.encoderProcess !== encoderProcess || recording.stopRequested) return;
    sendLog(mainWindow, `ERROR: la grabación de voz terminó inesperadamente (código ${code}).`);
    finish(mainWindow, 'error', code === 0 ? null : `FFmpeg terminó con código ${code}.`);
  });

  inputStream.on('data', (chunk) => {
    if (!recording || recording.inputStream !== inputStream || recording.stopRequested) return;
    try {
      if (encoderProcess.stdin && !encoderProcess.stdin.destroyed) encoderProcess.stdin.write(chunk);
    } catch {
      // El cierre/error del encoder informará del problema al operador.
    }
    const now = Date.now();
    if (now - recording.lastEmit >= VU_EMIT_INTERVAL_MS) {
      recording.lastEmit = now;
      const metrics = computeMetrics(chunk);
      sendPodcastRecordingLevel(mainWindow, {
        peak: metrics.peak,
        db: metrics.db,
        rmsDb: metrics.rmsDb,
        elapsedSeconds: (now - recording.startedAt) / 1000
      });
    }
  });
  inputStream.on('error', (error) => {
    if (recording) sendLog(mainWindow, `ERROR del micrófono al grabar voz: ${error.message}`);
  });

  inputStream.start();
  sendPodcastRecordingState(mainWindow, { state: 'recording', outputPath, elapsedSeconds: 0 });
  sendLog(mainWindow, `Grabación de voz iniciada: ${outputPath}`);
  return { ok: true, outputPath };
}

async function finish(mainWindow, state = 'stopped', message = null) {
  if (!recording) return { ok: false, reason: 'not-recording' };
  const current = recording;
  current.stopRequested = true;
  const durationSeconds = (Date.now() - current.startedAt) / 1000;
  try { current.inputStream.quit(() => {}); } catch { /* noop */ }
  await gracefullyCloseEncoder(current.encoderProcess);
  recording = null;
  const exists = fs.existsSync(current.outputPath);
  const result = {
    ok: state !== 'error' && exists,
    state,
    outputPath: current.outputPath,
    durationSeconds,
    message
  };
  sendPodcastRecordingState(mainWindow, {
    state: state === 'error' ? 'error' : 'stopped',
    outputPath: current.outputPath,
    durationSeconds,
    message
  });
  if (state !== 'error') sendLog(mainWindow, `Grabación de voz guardada (${durationSeconds.toFixed(1)} s).`);
  return result;
}

function stop(mainWindow) {
  return finish(mainWindow, 'stopped');
}

function shutdown() {
  if (!recording) return;
  const current = recording;
  recording = null;
  try { current.inputStream.quit(() => {}); } catch { /* noop */ }
  try { current.encoderProcess.kill(); } catch { /* noop */ }
}

function isRecording() {
  return recording !== null;
}

module.exports = { start, stop, shutdown, isRecording };
