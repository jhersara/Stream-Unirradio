const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveFfmpegPath } = require('../media/probe');
const audioCapture = require('../audio/capture');
const { computeSimpleLevels } = require('../audio/dsp');
const { asInt16 } = require('../audio/pcm');
const { getRecordingsRoot } = require('../../stores/podcast');
const { gracefullyEndProcess, killQuietly } = require('../../utils/process');
const { sendLog, sendPodcastRecordingState, sendPodcastRecordingLevel } = require('../../ipc/events');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const VU_EMIT_INTERVAL_MS = 100;

let recording = null;

function buildRecordingPath() {
  const root = getRecordingsRoot();
  fs.mkdirSync(root, { recursive: true });
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return path.join(root, `voz-${stamp}.mp3`);
}

function buildArgs(outputPath) {
  return [
    '-y', '-hide_banner', '-loglevel', 'warning', '-threads', '1',
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '192k',
    '-id3v2_version', '3',
    '-metadata', 'title=Grabación de voz · Stream Radio',
    '-metadata', 'comment=Voz grabada desde Podcast Studio',
    outputPath
  ];
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
    if (encoderProcess) killQuietly(encoderProcess);
    sendLog(mainWindow, `ERROR iniciando grabación de voz: ${error.message}`);
    return { ok: false, reason: 'start-failed', message: error.message };
  }

  recording = {
    outputPath,
    encoderProcess,
    inputStream,
    startedAt: Date.now(),
    lastEmit: 0,
    stopRequested: false
  };

  encoderProcess.stdin.on('error', () => { /* el cierre del encoder informa del problema */ });
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
      // El cierre/error del encoder informara del problema al operador.
    }
    const now = Date.now();
    if (now - recording.lastEmit >= VU_EMIT_INTERVAL_MS) {
      recording.lastEmit = now;
      const levels = computeSimpleLevels(asInt16(chunk));
      sendPodcastRecordingLevel(mainWindow, {
        peak: levels.peak,
        db: levels.db,
        rmsDb: levels.rmsDb,
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
  await gracefullyEndProcess(current.encoderProcess, 3500);
  recording = null;
  const exists = await fs.promises.access(current.outputPath).then(() => true, () => false);
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
  killQuietly(current.encoderProcess);
}

function isRecording() {
  return recording !== null;
}

module.exports = { start, stop, shutdown, isRecording };
