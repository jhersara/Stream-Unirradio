const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { resolveFfmpegPath } = require('./media-probe');
const libraryManager = require('./library-manager');
const audioCapture = require('./audio-capture');
const historyStore = require('./history-store');
const radioProviders = require('./radio-providers');
const { ShoutcastSourceBridge } = require('./shoutcast-source');
const {
  sendLog,
  sendStatus,
  sendVuLevel,
  sendPreviewVuLevel,
  sendSpectrum,
  sendDeadAir,
  sendIntroProgress,
  sendOutroProgress
} = require('./ipc-events');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
const OUTRO_CUTOFF_SECONDS = 2;
const CHUNK_MS = 50;
const VU_EMIT_INTERVAL_MS = 66;
const SPECTRUM_FFT_SIZE = 512;
const SPECTRUM_BAND_COUNT = 24;
const RECONNECT_DELAYS_MS = [3000, 6000, 12000, 24000, 30000];
const SILENCE_PEAK_THRESHOLD = 0.02; // ~ -34dB: bajo pero no absoluto, evita falsos positivos
const DEAD_AIR_SECONDS = 15;

// Solo se soporta UNA sesion de transmision activa a la vez (coincide con el
// diseno de un unico boton Iniciar/Detener en la interfaz).
let session = null;
let pendingStart = null;

// Prueba de microfono (fuera de una transmision real, ver startPreview).
let previewState = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsedSeconds() {
  if (!session || !session.startedAt) return 0;
  return (Date.now() - session.startedAt) / 1000;
}

function startStatusTicker() {
  if (!session) return;
  session.statusTimer = setInterval(() => {
    if (!session) return;
    sendStatus(session.mainWindow, session.phase, elapsedSeconds());
  }, 1000);
}

function stopStatusTicker() {
  if (session && session.statusTimer) {
    clearInterval(session.statusTimer);
    session.statusTimer = null;
  }
}

function writeToEncoder(chunk) {
  if (!session || !session.encoderProcess) return;
  const stdin = session.encoderProcess.stdin;
  if (!stdin || stdin.destroyed) return;
  try {
    stdin.write(chunk);
  } catch {
    // Pipe roto: el evento 'close'/'error' del proceso se encarga de
    // reportarlo y limpiar el estado.
  }
}

function writeEncodedOutput(chunk) {
  if (!session || !session.sourceBridge) return;
  const bridge = session.sourceBridge;
  if (bridge.write(chunk)) return;
  if (session.encoderProcess?.stdout && !session.encoderProcess.stdout.isPaused()) {
    session.encoderProcess.stdout.pause();
    bridge.once('drain', () => {
      if (session && session.sourceBridge === bridge && session.encoderProcess?.stdout) {
        session.encoderProcess.stdout.resume();
      }
    });
  }
}

function writeToRecorder(chunk) {
  if (!session || !session.recorderProcess) return;
  const stdin = session.recorderProcess.stdin;
  if (!stdin || stdin.destroyed) return;
  try {
    stdin.write(chunk);
  } catch {
    // Si la grabacion local falla no debe afectar la transmision en vivo;
    // el evento 'error'/'close' del proceso grabador ya lo reporta aparte.
  }
}

/** Escribe el mismo audio al encoder (Icecast) y, si aplica, a la grabacion local. */
function writeToOutputs(chunk) {
  writeToEncoder(chunk);
  writeToRecorder(chunk);
}

// ---------------------------------------------------------------------------
// Construccion del comando FFmpeg delegada al adaptador seleccionado.
// ---------------------------------------------------------------------------
function buildStreamProfile(config) {
  const validation = radioProviders.validateConfig(config);
  if (!validation.ok) {
    throw new Error(validation.errors.join(' '));
  }
  return radioProviders.buildEncoderProfile(config);
}

async function connectSourceBridge(mainWindow, profile, config) {
  if (!profile || profile.outputMode !== 'shoutcast-source') return null;
  const bridge = new ShoutcastSourceBridge({ ...config, streamId: profile.streamId });
  if (pendingStart) pendingStart.sourceBridge = bridge;
  try {
    await bridge.connect();
    sendLog(mainWindow, `Handshake SHOUTcast completado en ${profile.sourceHost}:${profile.sourcePort}.`);
    return bridge;
  } catch (err) {
    bridge.close();
    throw err;
  }
}

function buildRecorderArgs(outputPath) {
  return [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '128k',
    outputPath
  ];
}

function buildRecordingPath() {
  const dir = path.join(app.getPath('documents'), 'Stream Radio - Grabaciones');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return path.join(dir, `transmision-${stamp}.mp3`);
}

/**
 * Traduce lineas de stderr de ffmpeg conocidas (ver Fase 6 / prototipo
 * Python) a un mensaje de diagnostico entendible para el operador.
 */
function interpretFfmpegLine(line) {
  const lower = line.toLowerCase();
  if (lower.includes('400 bad request')) {
    return 'El servidor rechazo la conexion (400). Verifica el protocolo, el puerto y las credenciales del proveedor seleccionado.';
  }
  if (lower.includes(' 401') || lower.includes('unauthorized')) {
    return 'Credenciales incorrectas (401). Revisa usuario y contrasena en Configuracion.';
  }
  if (lower.includes(' 403') || lower.includes('forbidden')) {
    return 'Acceso denegado (403). El punto de montaje podria estar en uso o no autorizado.';
  }
  if (lower.includes(' 404') || lower.includes('not found')) {
    return 'Punto de montaje o Stream ID no encontrado (404). Verifica los datos copiados desde Live Source Connections.';
  }
  if (lower.includes('-10053') || lower.includes('-10054') || lower.includes('connection abort') || lower.includes('connection reset')) {
    return 'El servidor acepto la conexion y la cerro poco despues. Revisa el protocolo, el punto de montaje o Stream ID y la contraseña.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Decodificacion de intro/outro a PCM crudo (en memoria) para poder
// reproducirlos con ritmo controlado por nosotros (ver playTimedPcm).
// ---------------------------------------------------------------------------
function decodeToPcm(filePath) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = resolveFfmpegPath();
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', filePath,
      '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
      'pipe:1'
    ];
    let proc;
    try {
      proc = spawn(ffmpegPath, args, { windowsHide: true });
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
 * Reproduce un buffer PCM hacia el encoder a ritmo real (no "lo mas rapido
 * posible"), en trozos de CHUNK_MS. Esto es lo que permite:
 *  - que la barra de progreso de intro/outro refleje el tiempo real, y
 *  - que el corte de la conexion 2s antes del fin del outro sea preciso,
 * en vez de depender de la contrapresion (backpressure) de red/ffmpeg, que
 * no es predecible.
 *
 * Devuelve { promise, abort }. La promise resuelve con:
 *   { cutoff: true }  -> se alcanzo cutoffSeconds antes de terminar el buffer
 *   { cutoff: false, aborted: true }  -> se aborto desde afuera (stop de emergencia)
 *   { cutoff: false, aborted: false } -> se reprodujo el buffer completo
 */
function playTimedPcm(buffer, { onChunk, onProgress, cutoffSeconds }) {
  const durationSeconds = buffer.length / BYTES_PER_SECOND;
  let cursor = 0;
  let stopped = false;
  let timeoutHandle = null;
  const startTime = Date.now();

  const promise = new Promise((resolve) => {
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
        const cutoffBytes = Math.floor((cutoffSeconds * BYTES_PER_SECOND) / 4) * 4;
        targetBytes = Math.min(targetBytes, cutoffBytes);
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
  }

  return { promise, abort };
}

// ---------------------------------------------------------------------------
// Utilidades de audio: ganancia y nivel de pico/dB para el vumetro
// ---------------------------------------------------------------------------
function applyGain(buffer, gain) {
  if (!gain || gain === 1) return buffer;
  const out = Buffer.alloc(buffer.length);
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    let sample = buffer.readInt16LE(i) * gain;
    if (sample > 32767) sample = 32767;
    if (sample < -32768) sample = -32768;
    out.writeInt16LE(Math.round(sample), i);
  }
  return out;
}

function normalizedToDb(value) {
  return value > 0 ? 20 * Math.log10(Math.min(1, value)) : -100;
}

function computeAudioMetrics(buffer) {
  let peakLeft = 0;
  let peakRight = 0;
  let sumSquaresLeft = 0;
  let sumSquaresRight = 0;
  let frames = 0;

  // PCM estéreo 16-bit: L, R, L, R. Todo se calcula sobre el bloque ya
  // aplicado a ganancia, sin enviar el buffer hacia el renderer.
  for (let i = 0; i + 3 < buffer.length; i += 4) {
    const left = buffer.readInt16LE(i);
    const right = buffer.readInt16LE(i + 2);
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

function computePeakDb(buffer) {
  const metrics = computeAudioMetrics(buffer);
  return { peak: metrics.peak, db: metrics.db };
}

// ---------------------------------------------------------------------------
// Deteccion de "aire muerto": si el nivel de pico se queda por debajo del
// umbral de silencio de forma CONTINUA por mas de DEAD_AIR_SECONDS, se
// avisa una vez (no en cada chequeo, para no saturar el log/UI). Se limpia
// solo -- vuelve a avisar (con un aviso de "recuperado") en cuanto vuelve a
// haber señal.
// ---------------------------------------------------------------------------
function checkDeadAir(mainWindow, peak, now) {
  if (!session) return;
  if (peak < SILENCE_PEAK_THRESHOLD) {
    if (!session.silenceSince) session.silenceSince = now;
    const silentForSeconds = (now - session.silenceSince) / 1000;
    if (silentForSeconds >= DEAD_AIR_SECONDS && !session.deadAirActive) {
      session.deadAirActive = true;
      sendLog(mainWindow, `ALERTA: no se detecta audio desde hace ${Math.round(silentForSeconds)}s. Revisa el microfono.`);
      sendDeadAir(mainWindow, true);
    }
  } else {
    if (session.deadAirActive) {
      sendLog(mainWindow, 'Audio detectado de nuevo; todo normal.');
      sendDeadAir(mainWindow, false);
    }
    session.silenceSince = null;
    session.deadAirActive = false;
  }
}

// ---------------------------------------------------------------------------
// Ecualizador de espectro: FFT simple (radix-2 Cooley-Tukey, in-place) sobre
// una ventana del audio en vivo, agrupada en bandas logaritmicas (mas
// resolucion en graves, menos en agudos, como cualquier ecualizador visual).
// Se calcula SOLO dentro del mismo bloque ya limitado a ~15/seg que usa el
// vumetro (ver VU_EMIT_INTERVAL_MS) -- nunca en cada callback de audio, por
// la misma razon documentada ahi: mas trabajo por callback puede hacer que
// naudiodon se atrase y repita audio.
// ---------------------------------------------------------------------------
function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len / 2;
      for (let j = 0; j < half; j++) {
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

function computeSpectrum(buffer, bandCount) {
  const availableFrames = Math.floor(buffer.length / 4); // stereo 16-bit = 4 bytes/frame
  const sampleCount = Math.min(SPECTRUM_FFT_SIZE, availableFrames);
  const re = new Float64Array(SPECTRUM_FFT_SIZE);
  const im = new Float64Array(SPECTRUM_FFT_SIZE);

  for (let i = 0; i < sampleCount; i++) {
    const l = buffer.readInt16LE(i * 4);
    const r = buffer.readInt16LE(i * 4 + 2);
    const hann = sampleCount > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (sampleCount - 1)) : 1;
    re[i] = ((l + r) / 2 / 32768) * hann;
  }

  fftInPlace(re, im);

  const bins = SPECTRUM_FFT_SIZE / 2;
  const bands = new Array(bandCount).fill(0);
  for (let b = 0; b < bandCount; b++) {
    const startBin = Math.max(1, Math.floor(Math.pow(bins, b / bandCount)));
    const endBin = Math.max(startBin + 1, Math.floor(Math.pow(bins, (b + 1) / bandCount)));
    let sum = 0;
    let count = 0;
    for (let i = startBin; i < Math.min(endBin, bins); i++) {
      sum += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      count++;
    }
    const avg = count > 0 ? sum / count : 0;
    bands[b] = Math.min(1, Math.sqrt(avg) * 2.2);
  }
  return bands;
}

// ---------------------------------------------------------------------------
// Cierre ordenado de un proceso hijo (ffmpeg): cerrar stdin (EOF) y ESPERAR
// a que termine solo antes de matarlo. Si se mata de inmediato (SIGTERM) sin
// dar tiempo a vaciar el encoder, el archivo/stream queda con la cola sin
// escribir -- para el encoder de Icecast eso ademas provocaba el bug del
// bucle de 3-6s al final (ver README). Se aplica igual a la grabacion local
// para no dejar el mp3 truncado/corrupto.
// ---------------------------------------------------------------------------
function gracefullyEndProcess(proc, timeoutMs) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const graceTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch { /* noop */ }
      resolve();
    }, timeoutMs);

    proc.once('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      resolve();
    });

    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.end();
      } else {
        clearTimeout(graceTimer);
        settled = true;
        try { proc.kill(); } catch { /* noop */ }
        resolve();
      }
    } catch {
      clearTimeout(graceTimer);
      settled = true;
      try { proc.kill(); } catch { /* noop */ }
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Ciclo de vida del proceso ffmpeg (encoder de salida hacia Icecast)
// ---------------------------------------------------------------------------
function wireSourceBridgeEvents(mainWindow, bridge) {
  if (!bridge) return;
  bridge.on('error', (err) => {
    if (!session || session.sourceBridge !== bridge || session.stopRequested) return;
    sendLog(mainWindow, `ERROR de fuente SHOUTcast: ${err.message}`);
    session.sourceBridge = null;
    const encoder = session.encoderProcess;
    if (encoder) {
      try { encoder.kill(); } catch { /* noop */ }
      handleEncoderDrop(mainWindow, encoder);
    } else {
      handleUnexpectedTermination(mainWindow);
    }
  });
  bridge.on('close', () => {
    if (!session || session.sourceBridge !== bridge || session.stopRequested) return;
    sendLog(mainWindow, 'La fuente SHOUTcast cerró la conexión.');
    session.sourceBridge = null;
    const encoder = session.encoderProcess;
    if (encoder) {
      try { encoder.kill(); } catch { /* noop */ }
      handleEncoderDrop(mainWindow, encoder);
    }
  });
}

function wireEncoderProcessEvents(mainWindow, encoderProcess, sourceBridge = null) {
  encoderProcess.stderr.on('data', (chunk) => {
    chunk.toString().split('\n').forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      sendLog(mainWindow, `FFmpeg: ${line}`);
      const hint = interpretFfmpegLine(line);
      if (hint) sendLog(mainWindow, `Sugerencia: ${hint}`);
    });
  });

  if (sourceBridge && encoderProcess.stdout) {
    encoderProcess.stdout.on('data', (chunk) => writeEncodedOutput(chunk));
    wireSourceBridgeEvents(mainWindow, sourceBridge);
  }

  encoderProcess.on('error', (err) => {
    sendLog(mainWindow, `ERROR de FFmpeg: ${err.message}`);
    handleEncoderDrop(mainWindow, encoderProcess);
  });

  encoderProcess.on('close', (code) => {
    if (!session || session.encoderProcess !== encoderProcess || session.stopRequested) return;
    sendLog(mainWindow, `ERROR: FFmpeg se cerro inesperadamente (codigo ${code}).`);
    handleEncoderDrop(mainWindow, encoderProcess);
  });
}

/**
 * Se dispara cuando el proceso encoder muere sin que el usuario haya
 * pedido detener. Durante 'live' o 'intro' se intenta RECONECTAR solo
 * (ver attemptReconnect); en cualquier otra fase (incluida una
 * reconexion ya en curso, o el chequeo inicial de conexion en
 * startStream, que maneja su propio fallo por separado) simplemente se
 * ignora aqui para no manejar el mismo fallo dos veces.
 */
function handleEncoderDrop(mainWindow, encoderProcess) {
  if (!session || session.encoderProcess !== encoderProcess || session.stopRequested) return;
  if (session.phase === 'live' || session.phase === 'paused' || session.phase === 'intro') {
    attemptReconnect(mainWindow);
  } else if (session.phase === 'connecting') {
    // startStream ya revisa el estado del proceso despues de su propia
    // espera inicial; no duplicar el manejo del error aqui.
  } else {
    handleUnexpectedTermination(mainWindow);
  }
}

/**
 * Reconexion automatica: la captura de microfono (naudiodon) y la
 * grabacion local NO se detienen durante los reintentos -- solo se
 * quedan sin encoder al que escribir por un momento (writeToEncoder ya
 * es seguro si session.encoderProcess esta muerto/nulo). Esto evita
 * reabrir el dispositivo de audio repetidamente y mantiene la grabacion
 * local continua durante el corte.
 */
async function attemptReconnect(mainWindow) {
  if (!session || session.stopRequested) return;

  const shouldRemainPaused = session.phase === 'paused';
  session.phase = 'reconnecting';
  session.reconnectAttempt = (session.reconnectAttempt || 0) + 1;
  const attempt = session.reconnectAttempt;

  if (attempt > RECONNECT_DELAYS_MS.length) {
    sendLog(mainWindow, `No se pudo reconectar tras ${RECONNECT_DELAYS_MS.length} intentos. Cortando la transmision.`);
    handleUnexpectedTermination(mainWindow);
    return;
  }

  const delay = RECONNECT_DELAYS_MS[attempt - 1];
  sendStatus(mainWindow, 'reconnecting', elapsedSeconds());
  sendLog(mainWindow, `Conexion perdida. Reintentando en ${Math.round(delay / 1000)}s (intento ${attempt}/${RECONNECT_DELAYS_MS.length})...`);

  await wait(delay);
  if (!session || session.stopRequested) return;

  const config = session.config;
  if (session.sourceBridge) {
    session.sourceBridge.close();
    session.sourceBridge = null;
  }
  let profile;
  try {
    profile = buildStreamProfile(config);
  } catch (err) {
    sendLog(mainWindow, `ERROR de configuracion al reconectar: ${err.message}`);
    handleUnexpectedTermination(mainWindow);
    return;
  }

  let sourceBridge;
  try {
    sourceBridge = await connectSourceBridge(mainWindow, profile, config);
  } catch (err) {
    sendLog(mainWindow, `ERROR reconectando fuente ${profile.provider.label}: ${err.message}`);
    attemptReconnect(mainWindow);
    return;
  }
  if (!session || session.stopRequested) {
    sourceBridge?.close();
    return;
  }

  const ffmpegPath = resolveFfmpegPath();
  const args = profile.args;
  sendLog(mainWindow, `Reintentando conexion con ${profile.provider.label} en ${config.server}:${config.port} (intento ${attempt}/${RECONNECT_DELAYS_MS.length})...`);

  let encoderProcess;
  try {
    encoderProcess = spawn(ffmpegPath, args, { windowsHide: true });
  } catch (err) {
    sourceBridge?.close();
    sendLog(mainWindow, `ERROR reintentando: ${err.message}`);
    attemptReconnect(mainWindow);
    return;
  }

  session.encoderProcess = encoderProcess;
  session.sourceBridge = sourceBridge;
  wireEncoderProcessEvents(mainWindow, encoderProcess, sourceBridge);

  await wait(700);
  if (!session || session.stopRequested) return;

  if (session.encoderProcess !== encoderProcess || encoderProcess.exitCode !== null) {
    // Este intento fallo (o ya se reemplazo por otro reintento en curso);
    // seguir con el siguiente intento de la lista.
    attemptReconnect(mainWindow);
    return;
  }

  sendLog(mainWindow, shouldRemainPaused
    ? 'Reconectado correctamente. La transmisión permanece pausada.'
    : 'Reconectado correctamente. Continuando en vivo.');
  session.reconnectAttempt = 0;
  session.phase = shouldRemainPaused ? 'paused' : 'live';
  sendStatus(mainWindow, session.phase, elapsedSeconds());
}

function wireRecorderProcessEvents(mainWindow, recorderProcess) {
  recorderProcess.stderr.on('data', (chunk) => {
    chunk.toString().split('\n').forEach((rawLine) => {
      const line = rawLine.trim();
      if (line) sendLog(mainWindow, `Grabacion: ${line}`);
    });
  });
  recorderProcess.on('error', (err) => {
    sendLog(mainWindow, `Aviso: la grabacion local fallo (${err.message}). La transmision en vivo sigue normal.`);
    if (session && session.recorderProcess === recorderProcess) {
      session.recorderProcess = null;
    }
  });
}

function handleUnexpectedTermination(mainWindow) {
  if (!session) return;
  if (session.introController) session.introController.abort();
  if (session.outroController) session.outroController.abort();
  if (session.inputStream) {
    try { session.inputStream.quit(() => {}); } catch { /* noop */ }
  }
  if (session.recorderProcess) {
    try { session.recorderProcess.kill(); } catch { /* noop */ }
  }
  if (session.sourceBridge) {
    session.sourceBridge.close();
    session.sourceBridge = null;
  }
  stopStatusTicker();
  const finishedSession = session;
  session = null;
  logHistoryEntry(finishedSession, 'error');
  sendIntroProgress(mainWindow, { done: true });
  sendOutroProgress(mainWindow, { done: true });
  sendDeadAir(mainWindow, false);
  sendStatus(mainWindow, 'error', 0);
}

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
  } catch {
    // No dejar que un fallo guardando el historial afecte nada mas.
  }
}

// ---------------------------------------------------------------------------
// Prueba de microfono (fuera de sesion): solo escucha y manda nivel de vu,
// no conecta a Icecast ni escribe a ningun lado. Permite comprobar que el
// microfono elegido funciona antes de transmitir de verdad.
// ---------------------------------------------------------------------------
function startPreview(mainWindow, deviceId) {
  if (session) {
    return { ok: false, reason: 'streaming-active' };
  }
  if (previewState) {
    stopPreview();
  }
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

  previewState = { inputStream };
  let lastEmit = 0;

  inputStream.on('data', (chunk) => {
    if (!previewState) return;
    const now = Date.now();
    if (now - lastEmit < VU_EMIT_INTERVAL_MS) return;
    lastEmit = now;
    const { peak, db } = computePeakDb(chunk);
    sendPreviewVuLevel(mainWindow, peak, db);
  });
  inputStream.on('error', (err) => {
    sendLog(mainWindow, `ERROR probando microfono: ${err.message}`);
  });
  inputStream.start();

  return { ok: true };
}

function stopPreview() {
  if (!previewState) return { ok: true };
  try { previewState.inputStream.quit(() => {}); } catch { /* noop */ }
  previewState = null;
  return { ok: true };
}

function isPreviewing() {
  return previewState !== null;
}

// ---------------------------------------------------------------------------
// Secuencia: conectar -> (intro) -> vivo
// ---------------------------------------------------------------------------
async function startStream(mainWindow, rawConfig) {
  if (session || pendingStart) {
    sendLog(mainWindow, 'Ya hay una transmision en curso o conectándose.');
    return { ok: false, reason: 'already-streaming' };
  }

  // Si estaba corriendo una prueba de microfono, se detiene sola al pasar
  // a una transmision real (no pueden compartir el mismo dispositivo).
  stopPreview();

  if (!audioCapture.isAvailable()) {
    sendLog(mainWindow, 'ERROR: el modulo de captura de audio (naudiodon) no esta disponible. Revisa la Fase 1.5 del README (falta compilar con el Windows SDK instalado).');
    return { ok: false, reason: 'naudiodon-unavailable' };
  }

  const config = { ...rawConfig, provider: rawConfig.provider || 'zeno-icecast', gain: rawConfig.gain || 1 };
  pendingStart = { stopRequested: false, sourceBridge: null };
  let profile;
  try {
    profile = buildStreamProfile(config);
  } catch (err) {
    pendingStart = null;
    sendLog(mainWindow, `ERROR de configuracion: ${err.message}`);
    return { ok: false, reason: 'invalid-config' };
  }

  let sourceBridge;
  try {
    sourceBridge = await connectSourceBridge(mainWindow, profile, config);
  } catch (err) {
    if (!pendingStart || pendingStart.stopRequested) {
      pendingStart = null;
      return { ok: false, reason: 'stopped-during-connection' };
    }
    pendingStart = null;
    sendLog(mainWindow, `ERROR conectando ${profile.provider.label}: ${err.message}`);
    return { ok: false, reason: 'source-connection-failed' };
  }
  if (pendingStart?.stopRequested) {
    sourceBridge?.close();
    pendingStart = null;
    return { ok: false, reason: 'stopped-during-connection' };
  }
  if (session && session.stopRequested) {
    sourceBridge?.close();
    return { ok: false, reason: 'stopped-during-connection' };
  }

  const ffmpegPath = resolveFfmpegPath();
  const args = profile.args;

  sendLog(mainWindow, `Estableciendo conexion ${profile.provider.label} con ${config.server}:${config.port}${config.mount ? `/${config.mount}` : ''}...`);

  let encoderProcess;
  try {
    encoderProcess = spawn(ffmpegPath, args, { windowsHide: true });
  } catch (err) {
    sourceBridge?.close();
    pendingStart = null;
    sendLog(mainWindow, `ERROR: no se pudo iniciar ffmpeg (${err.message}).`);
    return { ok: false, reason: 'spawn-failed' };
  }

  session = {
    mainWindow,
    config,
    encoderProcess,
    sourceBridge,
    recorderProcess: null,
    recordingPath: null,
    inputStream: null,
    gain: config.gain,
    startedAt: null,
    phase: 'connecting',
    stopRequested: false,
    statusTimer: null,
    introController: null,
    outroController: null,
    introPcmPromise: null,
    outroPcmPromise: null
  };
  pendingStart = null;

  // Grabacion local opcional (el usuario decide Si/No al darle Iniciar,
  // ver renderer.js). Se abre un proceso ffmpeg aparte que recibe el MISMO
  // audio (intro + vivo + outro) que va al encoder de Icecast.
  if (config.recordSession) {
    try {
      const recordingPath = buildRecordingPath();
      const recorderProcess = spawn(ffmpegPath, buildRecorderArgs(recordingPath), { windowsHide: true });
      session.recorderProcess = recorderProcess;
      session.recordingPath = recordingPath;
      wireRecorderProcessEvents(mainWindow, recorderProcess);
      sendLog(mainWindow, `Grabando esta transmision en: ${recordingPath}`);
    } catch (err) {
      sendLog(mainWindow, `Aviso: no se pudo iniciar la grabacion local (${err.message}). La transmision sigue normal.`);
    }
  }

  // Pre-decodificar intro/outro a PCM EN PARALELO (intro: mientras se
  // confirma la conexion; outro: durante toda la sesion), para que cuando
  // de verdad haga falta reproducirlos ya esten listos en memoria. Esto
  // evita el hueco de silencio entre "el vivo termina" y "el outro empieza
  // a sonar" que antes se generaba mientras ffmpeg decodificaba el archivo.
  if (config.introEnabled && config.introTrackId) {
    const introPathEarly = libraryManager.getTrackPath(config.introTrackId);
    if (introPathEarly) {
      session.introPcmPromise = decodeToPcm(introPathEarly).catch((err) => {
        sendLog(mainWindow, `Aviso: no se pudo pre-cargar el intro (${err.message}).`);
        return null;
      });
    }
  }
  if (config.outroEnabled && config.outroTrackId) {
    const outroPathEarly = libraryManager.getTrackPath(config.outroTrackId);
    if (outroPathEarly) {
      session.outroPcmPromise = decodeToPcm(outroPathEarly).catch((err) => {
        sendLog(mainWindow, `Aviso: no se pudo pre-cargar el outro (${err.message}).`);
        return null;
      });
    }
  }

  wireEncoderProcessEvents(mainWindow, encoderProcess, sourceBridge);

  await wait(700);

  if (!session || session.encoderProcess.exitCode !== null) {
    sendLog(mainWindow, 'ERROR: FFmpeg termino inmediatamente al conectar. Revisa credenciales, mountpoint, y que ffmpeg.exe este en resources/ffmpeg/.');
    session = null;
    return { ok: false, reason: 'ffmpeg-exit' };
  }

  sendLog(mainWindow, 'Encoder FFmpeg iniciado correctamente.');
  session.startedAt = Date.now();
  startStatusTicker();

  // A partir de aqui la secuencia intro -> vivo corre en segundo plano via
  // eventos IPC; el handler de 'stream:start' ya puede devolver el control.
  runIntroThenLive(mainWindow).catch((err) => {
    sendLog(mainWindow, `Error en la secuencia de inicio: ${err.message}`);
  });

  return { ok: true };
}

async function runIntroThenLive(mainWindow) {
  if (!session) return;
  const config = session.config;

  if (config.introEnabled && config.introTrackId) {
    const introPath = libraryManager.getTrackPath(config.introTrackId);
    if (introPath) {
      session.phase = 'intro';
      sendStatus(mainWindow, 'intro', elapsedSeconds());
      sendLog(mainWindow, 'Decodificando intro...');
      try {
        let pcm = session.introPcmPromise ? await session.introPcmPromise : null;
        if (!pcm) {
          pcm = await decodeToPcm(introPath);
        }
        if (!session || session.stopRequested) return;
        sendLog(mainWindow, 'Reproduciendo intro...');
        const { promise, abort } = playTimedPcm(pcm, {
          onChunk: writeToOutputs,
          onProgress: (elapsedT, durationT) => sendIntroProgress(mainWindow, { elapsedSeconds: elapsedT, durationSeconds: durationT })
        });
        session.introController = { abort };
        await promise;
        sendIntroProgress(mainWindow, { done: true });
      } catch (err) {
        sendLog(mainWindow, `ERROR reproduciendo intro: ${err.message}`);
        sendIntroProgress(mainWindow, { done: true });
      }
    } else {
      sendLog(mainWindow, 'Intro activado pero no hay ninguna pista seleccionada en Configuracion.');
    }
  }

  if (!session || session.stopRequested) return;
  beginLiveCapture(mainWindow);
}

function beginLiveCapture(mainWindow) {
  if (!session) return;
  session.phase = 'live';
  session.silenceSince = null;
  session.deadAirActive = false;
  sendStatus(mainWindow, 'live', elapsedSeconds());
  sendLog(mainWindow, 'Transmision en vivo activa.');

  let inputStream;
  try {
    inputStream = audioCapture.createInputStream(session.config.deviceId, SAMPLE_RATE, CHANNELS);
  } catch (err) {
    sendLog(mainWindow, `ERROR iniciando captura de audio: ${err.message}`);
    return;
  }
  session.inputStream = inputStream;

  // Limitar el envio de nivel de vumetro por IPC (no en cada callback de
  // audio, que puede llegar decenas de veces por segundo). Mandar un
  // mensaje IPC en cada callback compite por el mismo hilo de JS que debe
  // seguir escribiendole al pipe de ffmpeg a tiempo real; si ese hilo se
  // atrasa, naudiodon puede terminar reenviando/repitiendo audio del
  // buffer interno para compensar, lo que se escucha como un eco/repeticion
  // en la transmision. 15 actualizaciones/seg siguen siendo fluidas para el
  // ojo humano y le quitan presion al hot path de audio.
  let lastVuEmit = 0;

  inputStream.on('data', (chunk) => {
    if (!session || (session.phase !== 'live' && session.phase !== 'reconnecting' && session.phase !== 'paused')) return;
    if (session.phase === 'paused') {
      // Mantener vivo el encoder y la fuente remota sin transmitir el micrófono.
      // Se conserva la duración de la emisión enviando silencio PCM del mismo tamaño.
      writeToOutputs(Buffer.alloc(chunk.length));
      return;
    }
    const gained = applyGain(chunk, session.gain);
    writeToOutputs(gained);

    const now = Date.now();
    if (now - lastVuEmit >= VU_EMIT_INTERVAL_MS) {
      lastVuEmit = now;
      const metrics = computeAudioMetrics(gained);
      sendVuLevel(mainWindow, metrics.peak, metrics.db, metrics);
      sendSpectrum(mainWindow, computeSpectrum(gained, SPECTRUM_BAND_COUNT));
      checkDeadAir(mainWindow, metrics.peak, now);
    }
  });

  inputStream.on('error', (err) => {
    sendLog(mainWindow, `ERROR de captura de audio: ${err.message}`);
  });

  inputStream.start();
}

// ---------------------------------------------------------------------------
// Pausar/Reanudar: mantiene la conexión remota y sustituye el micrófono por
// silencio PCM para no dejar un hueco de transporte ni cerrar el servidor.
// ---------------------------------------------------------------------------
function togglePauseStream(mainWindow) {
  if (!session) {
    sendLog(mainWindow, 'No hay ninguna transmisión activa para pausar.');
    return { ok: false, reason: 'not-streaming' };
  }
  if (session.phase === 'live') {
    session.phase = 'paused';
    sendStatus(mainWindow, 'paused', elapsedSeconds());
    sendLog(mainWindow, 'Transmisión pausada. Se envía silencio mientras la conexión permanece activa.');
    return { ok: true, paused: true };
  }
  if (session.phase === 'paused') {
    session.phase = 'live';
    sendStatus(mainWindow, 'live', elapsedSeconds());
    sendLog(mainWindow, 'Transmisión reanudada. El micrófono vuelve a estar al aire.');
    return { ok: true, paused: false };
  }
  sendLog(mainWindow, 'La transmisión solo puede pausarse cuando el audio en vivo está activo.');
  return { ok: false, reason: 'not-live' };
}

// ---------------------------------------------------------------------------
// Detener: (opcional outro con corte diferido a -2s) -> cerrar conexion real
// ---------------------------------------------------------------------------
async function stopStream(mainWindow) {
  if (!session && pendingStart) {
    pendingStart.stopRequested = true;
    pendingStart.sourceBridge?.close();
    pendingStart = null;
    sendIntroProgress(mainWindow, { done: true });
    sendLog(mainWindow, 'Conexión detenida mientras se autenticaba con el proveedor.');
    sendStatus(mainWindow, 'idle', 0);
    return { ok: true };
  }
  if (!session) {
    sendLog(mainWindow, 'No hay ninguna transmision activa para detener.');
    return { ok: false, reason: 'not-streaming' };
  }

  session.stopRequested = true;
  const phaseAtStop = session.phase;

  if (phaseAtStop === 'connecting' || phaseAtStop === 'intro' || phaseAtStop === 'reconnecting') {
    if (session.introController) session.introController.abort();
    sendIntroProgress(mainWindow, { done: true });
    if (session.inputStream) {
      try { session.inputStream.quit(() => {}); } catch { /* noop */ }
      session.inputStream = null;
    }
    sendLog(mainWindow, phaseAtStop === 'reconnecting'
      ? 'Transmision detenida mientras se intentaba reconectar.'
      : 'Transmision detenida antes de llegar al audio en vivo.');
    await teardownSession(mainWindow, 'idle');
    return { ok: true };
  }

  if (phaseAtStop === 'live' || phaseAtStop === 'paused') {
    // Cambiar de fase ANTES de detener la captura: el guard del handler
    // 'data' de audio (`session.phase !== 'live'`) debe bloquear cualquier
    // callback que naudiodon dispare durante su propio apagado. Algunos
    // bindings nativos de audio entregan un ultimo bloque que puede
    // duplicar contenido ya enviado justo al cerrar el stream -- eso es lo
    // que sonaba como un eco/repeticion de la ultima palabra al detener.
    session.phase = 'outro';

    if (session.inputStream) {
      try { session.inputStream.quit(() => {}); } catch { /* noop */ }
      session.inputStream = null;
    }

    const config = session.config;
    const outroConfigured = Boolean(config.outroEnabled && config.outroTrackId);
    const outroPath = outroConfigured ? libraryManager.getTrackPath(config.outroTrackId) : null;

    if (outroPath) {
      sendStatus(mainWindow, 'outro', elapsedSeconds());
      sendLog(mainWindow, `Reproduciendo outro; la conexion se cerrara ${OUTRO_CUTOFF_SECONDS}s antes de que termine.`);
      try {
        // Preferir el buffer pre-decodificado en paralelo (ver startStream):
        // si ya esta listo, la reproduccion arranca sin ningun hueco de
        // silencio. Si por algo fallo o no alcanzo a resolver, se decodifica
        // ahora como respaldo.
        let pcm = session.outroPcmPromise ? await session.outroPcmPromise : null;
        if (!pcm) {
          pcm = await decodeToPcm(outroPath);
        }
        const durationSeconds = pcm.length / BYTES_PER_SECOND;
        const cutoffSeconds = Math.max(0, durationSeconds - OUTRO_CUTOFF_SECONDS);
        const { promise, abort } = playTimedPcm(pcm, {
          onChunk: writeToOutputs,
          onProgress: (elapsedT, durationT) => sendOutroProgress(mainWindow, { elapsedSeconds: elapsedT, durationSeconds: durationT }),
          cutoffSeconds
        });
        session.outroController = { abort };
        const result = await promise;
        if (result.cutoff) {
          sendLog(mainWindow, `Cortando la conexion (faltaban ${OUTRO_CUTOFF_SECONDS}s para el final del outro).`);
        }
      } catch (err) {
        sendLog(mainWindow, `ERROR reproduciendo outro: ${err.message}`);
      }
      sendOutroProgress(mainWindow, { done: true });
    } else {
      sendLog(mainWindow, 'Outro no configurado; cerrando la conexion.');
    }

    await teardownSession(mainWindow, 'idle');
    return { ok: true };
  }

  await teardownSession(mainWindow, 'idle');
  return { ok: true };
}

async function teardownSession(mainWindow, finalStatusKind) {
  stopStatusTicker();
  const finishedSession = session;
  session = null;
  if (finishedSession?.sourceBridge) finishedSession.sourceBridge.close();

  await Promise.all([
    gracefullyEndProcess(finishedSession ? finishedSession.encoderProcess : null, 2500),
    gracefullyEndProcess(finishedSession ? finishedSession.recorderProcess : null, 2500)
  ]);

  logHistoryEntry(finishedSession, 'manual');

  if (finishedSession && finishedSession.recordingPath) {
    sendLog(mainWindow, `Grabacion guardada en: ${finishedSession.recordingPath}`);
  }

  sendDeadAir(mainWindow, false);
  sendStatus(mainWindow, finalStatusKind, 0);
  sendLog(mainWindow, 'Transmision finalizada. Desconectado del servidor.');
}

// ---------------------------------------------------------------------------
// Ganancia en vivo (el slider puede moverse durante la transmision)
// ---------------------------------------------------------------------------
function setGain(value) {
  if (session) {
    session.gain = value;
  }
}

// ---------------------------------------------------------------------------
// Limpieza de emergencia al cerrar la app (evita procesos ffmpeg huerfanos)
// ---------------------------------------------------------------------------
function shutdown() {
  stopPreview();
  if (!session) return;
  stopStatusTicker();
  if (session.introController) session.introController.abort();
  if (session.outroController) session.outroController.abort();
  if (session.inputStream) {
    try { session.inputStream.quit(() => {}); } catch { /* noop */ }
  }
  if (session.encoderProcess) {
    try { session.encoderProcess.kill(); } catch { /* noop */ }
  }
  if (session.recorderProcess) {
    try { session.recorderProcess.kill(); } catch { /* noop */ }
  }
  logHistoryEntry(session, 'app-closed');
  session = null;
}

function isStreaming() {
  return session !== null;
}

module.exports = {
  startStream,
  stopStream,
  togglePauseStream,
  setGain,
  shutdown,
  isStreaming,
  startPreview,
  stopPreview,
  isPreviewing
};
