const { spawn } = require('child_process');
const { resolveFfmpegPath } = require('./media-probe');
const libraryManager = require('./library-manager');
const audioCapture = require('./audio-capture');
const {
  sendLog,
  sendStatus,
  sendVuLevel,
  sendIntroProgress,
  sendOutroProgress
} = require('./ipc-events');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
const OUTRO_CUTOFF_SECONDS = 2;
const CHUNK_MS = 50;

// Solo se soporta UNA sesion de transmision activa a la vez (coincide con el
// diseno de un unico boton Iniciar/Detener en la interfaz).
let session = null;

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

// ---------------------------------------------------------------------------
// Construccion de comando ffmpeg / URL Icecast
// (misma logica ya validada en el prototipo Python: icecast:// + legacy_icecast)
// ---------------------------------------------------------------------------
function buildIcecastUrl(config) {
  const user = encodeURIComponent(config.user);
  const pass = encodeURIComponent(config.password);
  const mount = encodeURIComponent(config.mount.replace(/^\/+/, ''));
  return `icecast://${user}:${pass}@${config.server}:${config.port}/${mount}`;
}

function buildEncoderArgs(icecastUrl) {
  return [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', String(SAMPLE_RATE),
    '-f', 'mp3',
    '-content_type', 'audio/mpeg',
    '-legacy_icecast', '1',
    '-ice_name', 'UNIR Radio - Stream en vivo',
    '-ice_description', 'Transmision en vivo via Stream UNIR Radio',
    '-ice_genre', 'Various',
    '-ice_url', 'https://unirradio.com',
    '-fflags', 'nobuffer',
    icecastUrl
  ];
}

/**
 * Traduce lineas de stderr de ffmpeg conocidas (ver Fase 6 / prototipo
 * Python) a un mensaje de diagnostico entendible para el operador.
 */
function interpretFfmpegLine(line) {
  const lower = line.toLowerCase();
  if (lower.includes('400 bad request')) {
    return 'El servidor rechazo la conexion (400). Verifica que se este usando icecast:// con -legacy_icecast activo.';
  }
  if (lower.includes(' 401') || lower.includes('unauthorized')) {
    return 'Credenciales incorrectas (401). Revisa usuario y contrasena en Configuracion.';
  }
  if (lower.includes(' 403') || lower.includes('forbidden')) {
    return 'Acceso denegado (403). El punto de montaje podria estar en uso o no autorizado.';
  }
  if (lower.includes(' 404') || lower.includes('not found')) {
    return 'Punto de montaje no encontrado (404). Verifica que coincida EXACTAMENTE con el panel de Zeno.fm.';
  }
  if (lower.includes('-10053') || lower.includes('-10054') || lower.includes('connection abort') || lower.includes('connection reset')) {
    return 'El servidor acepto la conexion y la cerro poco despues. Causa mas comun: el Punto de Montaje o la Contrasena no coinciden EXACTAMENTE con los de tu panel de Zeno.fm.';
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
  const chunkBytes = Math.max(4, Math.floor(BYTES_PER_SECOND * (CHUNK_MS / 1000) / 4) * 4);
  let cursor = 0;
  let stopped = false;
  let timeoutHandle = null;

  const promise = new Promise((resolve) => {
    function tick() {
      if (stopped) {
        resolve({ cutoff: false, aborted: true });
        return;
      }
      if (cursor >= buffer.length) {
        onProgress(durationSeconds, durationSeconds);
        resolve({ cutoff: false, aborted: false });
        return;
      }
      const elapsed = cursor / BYTES_PER_SECOND;
      if (cutoffSeconds != null && elapsed >= cutoffSeconds) {
        resolve({ cutoff: true, aborted: false });
        return;
      }
      const end = Math.min(cursor + chunkBytes, buffer.length);
      const chunk = buffer.subarray(cursor, end);
      onChunk(chunk);
      cursor = end;
      onProgress(cursor / BYTES_PER_SECOND, durationSeconds);
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

function computePeakDb(buffer) {
  let peak = 0;
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const abs = Math.abs(buffer.readInt16LE(i));
    if (abs > peak) peak = abs;
  }
  const normalized = peak / 32768;
  const db = normalized > 0 ? 20 * Math.log10(normalized) : -100;
  return { peak: normalized, db };
}

// ---------------------------------------------------------------------------
// Ciclo de vida del proceso ffmpeg (encoder de salida hacia Icecast)
// ---------------------------------------------------------------------------
function wireEncoderProcessEvents(mainWindow, encoderProcess) {
  encoderProcess.stderr.on('data', (chunk) => {
    chunk.toString().split('\n').forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      sendLog(mainWindow, `FFmpeg: ${line}`);
      const hint = interpretFfmpegLine(line);
      if (hint) sendLog(mainWindow, `Sugerencia: ${hint}`);
    });
  });

  encoderProcess.on('error', (err) => {
    sendLog(mainWindow, `ERROR de FFmpeg: ${err.message}`);
    handleUnexpectedTermination(mainWindow, encoderProcess);
  });

  encoderProcess.on('close', (code) => {
    if (session && session.encoderProcess === encoderProcess && !session.stopRequested) {
      sendLog(mainWindow, `ERROR: FFmpeg se cerro inesperadamente (codigo ${code}).`);
      handleUnexpectedTermination(mainWindow, encoderProcess);
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
  stopStatusTicker();
  session = null;
  sendIntroProgress(mainWindow, { done: true });
  sendOutroProgress(mainWindow, { done: true });
  sendStatus(mainWindow, 'error', 0);
}

// ---------------------------------------------------------------------------
// Secuencia: conectar -> (intro) -> vivo
// ---------------------------------------------------------------------------
async function startStream(mainWindow, rawConfig) {
  if (session) {
    sendLog(mainWindow, 'Ya hay una transmision en curso.');
    return { ok: false, reason: 'already-streaming' };
  }

  if (!audioCapture.isAvailable()) {
    sendLog(mainWindow, 'ERROR: el modulo de captura de audio (naudiodon) no esta disponible. Revisa la Fase 1.5 del README (falta compilar con el Windows SDK instalado).');
    return { ok: false, reason: 'naudiodon-unavailable' };
  }

  const config = { ...rawConfig, gain: rawConfig.gain || 1 };
  let icecastUrl;
  try {
    icecastUrl = buildIcecastUrl(config);
  } catch (err) {
    sendLog(mainWindow, `ERROR de configuracion: ${err.message}`);
    return { ok: false, reason: 'invalid-config' };
  }

  const ffmpegPath = resolveFfmpegPath();
  const args = buildEncoderArgs(icecastUrl);

  sendLog(mainWindow, `Estableciendo conexion Icecast con ${config.server}:${config.port}/${config.mount}...`);

  let encoderProcess;
  try {
    encoderProcess = spawn(ffmpegPath, args, { windowsHide: true });
  } catch (err) {
    sendLog(mainWindow, `ERROR: no se pudo iniciar ffmpeg (${err.message}).`);
    return { ok: false, reason: 'spawn-failed' };
  }

  session = {
    mainWindow,
    config,
    encoderProcess,
    inputStream: null,
    gain: config.gain,
    startedAt: null,
    phase: 'connecting',
    stopRequested: false,
    statusTimer: null,
    introController: null,
    outroController: null
  };

  wireEncoderProcessEvents(mainWindow, encoderProcess);

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
        const pcm = await decodeToPcm(introPath);
        if (!session || session.stopRequested) return;
        sendLog(mainWindow, 'Reproduciendo intro...');
        const { promise, abort } = playTimedPcm(pcm, {
          onChunk: writeToEncoder,
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

  inputStream.on('data', (chunk) => {
    if (!session || session.phase !== 'live') return;
    const gained = applyGain(chunk, session.gain);
    writeToEncoder(gained);
    const { peak, db } = computePeakDb(gained);
    sendVuLevel(mainWindow, peak, db);
  });

  inputStream.on('error', (err) => {
    sendLog(mainWindow, `ERROR de captura de audio: ${err.message}`);
  });

  inputStream.start();
}

// ---------------------------------------------------------------------------
// Detener: (opcional outro con corte diferido a -2s) -> cerrar conexion real
// ---------------------------------------------------------------------------
async function stopStream(mainWindow) {
  if (!session) {
    sendLog(mainWindow, 'No hay ninguna transmision activa para detener.');
    return { ok: false, reason: 'not-streaming' };
  }

  session.stopRequested = true;
  const phaseAtStop = session.phase;

  if (phaseAtStop === 'connecting' || phaseAtStop === 'intro') {
    if (session.introController) session.introController.abort();
    sendIntroProgress(mainWindow, { done: true });
    sendLog(mainWindow, 'Transmision detenida antes de llegar al audio en vivo.');
    await teardownSession(mainWindow, 'idle');
    return { ok: true };
  }

  if (phaseAtStop === 'live') {
    if (session.inputStream) {
      try { session.inputStream.quit(() => {}); } catch { /* noop */ }
      session.inputStream = null;
    }

    const config = session.config;
    let outroPath = null;
    if (config.outroEnabled && config.outroTrackId) {
      outroPath = libraryManager.getTrackPath(config.outroTrackId);
    }

    if (outroPath) {
      session.phase = 'outro';
      sendStatus(mainWindow, 'outro', elapsedSeconds());
      sendLog(mainWindow, `Reproduciendo outro; la conexion se cerrara ${OUTRO_CUTOFF_SECONDS}s antes de que termine.`);
      try {
        const pcm = await decodeToPcm(outroPath);
        const durationSeconds = pcm.length / BYTES_PER_SECOND;
        const cutoffSeconds = Math.max(0, durationSeconds - OUTRO_CUTOFF_SECONDS);
        const { promise, abort } = playTimedPcm(pcm, {
          onChunk: writeToEncoder,
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

function teardownSession(mainWindow, finalStatusKind) {
  return new Promise((resolve) => {
    stopStatusTicker();
    if (session && session.encoderProcess) {
      const proc = session.encoderProcess;
      try {
        if (proc.stdin && !proc.stdin.destroyed) proc.stdin.end();
      } catch { /* noop */ }
      try { proc.kill(); } catch { /* noop */ }
    }
    session = null;
    sendStatus(mainWindow, finalStatusKind, 0);
    sendLog(mainWindow, 'Transmision finalizada. Desconectado del servidor.');
    resolve();
  });
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
  session = null;
}

function isStreaming() {
  return session !== null;
}

module.exports = { startStream, stopStream, setGain, shutdown, isStreaming };
