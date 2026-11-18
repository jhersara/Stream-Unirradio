const state = require('./state');
const { SAMPLE_RATE, CHANNELS, BYTES_PER_SECOND, MAX_PIPE_QUEUE_BYTES, OUTRO_CUTOFF_SECONDS, MAX_PREDECODE_SECONDS } = require('./constants');
const { PipeWriter } = require('./pipe-writer');
const { writeToOutputs } = require('./output');
const { decodeToPcm, playTimedPcm } = require('./pcm-player');
const { createLiveMetricsState, pushLiveChunk } = require('./live-metrics');
const { wait, elapsedSeconds, startStatusTicker, stopStatusTicker } = require('./status');
const { startLocalRecorder, savePendingRecording } = require('./local-recording');
const { buildStreamProfile, connectSourceBridge, spawnEncoder, wireEncoderProcessEvents } = require('./connection');
const { teardownSession, releaseSessionInput } = require('./teardown');
const { logHistoryEntry } = require('./history-log');
const { stopPreview } = require('./preview');
const audioCapture = require('../audio/capture');
const { copyChunk, applyGainInPlace, getSilence } = require('../audio/pcm');
const libraryManager = require('../media/library');
const { killQuietly } = require('../../utils/process');
const { sendLog, sendStatus, sendDeadAir, sendIntroProgress, sendOutroProgress } = require('../../ipc/events');

function createSession(mainWindow, config, sourceBridge) {
  return {
    mainWindow,
    config,
    encoderProcess: null,
    sourceBridge,
    recorderProcess: null,
    recordingPath: null,
    recordingTempPath: null,
    recordingStamp: null,
    recordingSavePrompt: config.recordingSavePrompt !== false && config.scheduled !== true,
    recordingRequested: Boolean(config.recordSession),
    inputStream: null,
    gain: config.gain,
    startedAt: null,
    phase: 'connecting',
    stopRequested: false,
    statusTimer: null,
    introController: null,
    outroController: null,
    introPcmPromise: null,
    outroPcmPromise: null,
    reconnectAttempt: 0,
    silenceSince: null,
    deadAirActive: false,
    metrics: createLiveMetricsState(),
    outputQueue: [],
    outputQueueBytes: 0,
    outputQueueWarned: false,
    outputPumpScheduled: false,
    encoderWriter: new PipeWriter({
      maxBytes: MAX_PIPE_QUEUE_BYTES,
      onOverflow: () => sendLog(mainWindow, 'Aviso: el encoder está saturado; se limita la cola de audio para evitar que la aplicación consuma memoria sin límite.')
    }),
    recorderWriter: new PipeWriter({
      maxBytes: MAX_PIPE_QUEUE_BYTES,
      onOverflow: () => sendLog(mainWindow, 'Aviso: la grabación local está más lenta; se limita su cola sin afectar la transmisión.'),
      onBackpressure: () => sendLog(mainWindow, 'Aviso: la grabación local está procesando más lento; la transmisión en vivo no se detendrá.')
    })
  };
}

/**
 * Pre-decodifica intro/outro a PCM en paralelo para que, cuando haga falta,
 * ya esten en memoria (sin hueco de silencio). El outro largo no se
 * pre-decodifica durante toda la sesion para no retener decenas de MB.
 */
function predecodeTracks(session, mainWindow, config) {
  if (config.introEnabled && config.introTrackId) {
    const introPath = libraryManager.getTrackPath(config.introTrackId);
    if (introPath) {
      session.introPcmPromise = decodeToPcm(introPath).catch((err) => {
        sendLog(mainWindow, `Aviso: no se pudo pre-cargar el intro (${err.message}).`);
        return null;
      });
    }
  }
  if (config.outroEnabled && config.outroTrackId) {
    const outroPath = libraryManager.getTrackPath(config.outroTrackId);
    const duration = libraryManager.getTrack(config.outroTrackId)?.durationSeconds;
    if (outroPath && (!duration || duration <= MAX_PREDECODE_SECONDS)) {
      session.outroPcmPromise = decodeToPcm(outroPath).catch((err) => {
        sendLog(mainWindow, `Aviso: no se pudo pre-cargar el outro (${err.message}).`);
        return null;
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Secuencia: conectar -> (intro) -> vivo
// ---------------------------------------------------------------------------
async function startStream(mainWindow, rawConfig) {
  if (state.pendingRecording) {
    // Una grabacion sin guardar no debe dejar la app sin poder transmitir:
    // se guarda en la carpeta predeterminada y se continua.
    sendLog(mainWindow, 'Hay una grabación pendiente; se guarda en la carpeta predeterminada antes de iniciar.');
    const saved = await savePendingRecording(mainWindow, { useDefault: true });
    if (!saved?.ok) {
      sendLog(mainWindow, 'No se pudo guardar la grabación pendiente. Revisa el diálogo de guardado antes de iniciar otra transmisión.');
      return { ok: false, reason: 'recording-save-pending' };
    }
  }
  if (state.session || state.pendingStart) {
    sendLog(mainWindow, 'Ya hay una transmision en curso o conectándose.');
    return { ok: false, reason: 'already-streaming' };
  }

  // La prueba de microfono no puede compartir el dispositivo con la emision.
  stopPreview();

  if (!audioCapture.isAvailable()) {
    sendLog(mainWindow, 'ERROR: el modulo de captura de audio (naudiodon) no esta disponible. Revisa la Fase 1.5 del README (falta compilar con el Windows SDK instalado).');
    return { ok: false, reason: 'naudiodon-unavailable' };
  }

  const config = { ...rawConfig, provider: rawConfig.provider || 'zeno-icecast', gain: rawConfig.gain || 1 };
  const pending = { stopRequested: false, sourceBridge: null };
  state.pendingStart = pending;
  const wasStopped = () => state.pendingStart !== pending || pending.stopRequested;
  const clearPending = () => { if (state.pendingStart === pending) state.pendingStart = null; };

  let profile;
  try {
    profile = buildStreamProfile(config);
  } catch (err) {
    clearPending();
    sendLog(mainWindow, `ERROR de configuracion: ${err.message}`);
    return { ok: false, reason: 'invalid-config' };
  }

  let sourceBridge;
  try {
    sourceBridge = await connectSourceBridge(mainWindow, profile, config);
  } catch (err) {
    const stopped = wasStopped();
    clearPending();
    if (stopped) return { ok: false, reason: 'stopped-during-connection' };
    sendLog(mainWindow, `ERROR conectando ${profile.provider.label}: ${err.message}`);
    return { ok: false, reason: 'source-connection-failed' };
  }
  if (wasStopped()) {
    sourceBridge?.close();
    clearPending();
    return { ok: false, reason: 'stopped-during-connection' };
  }

  sendLog(mainWindow, `Estableciendo conexion ${profile.provider.label} con ${config.server}:${config.port}${config.mount ? `/${config.mount}` : ''}...`);

  const session = createSession(mainWindow, config, sourceBridge);
  try {
    session.encoderProcess = spawnEncoder(profile, session);
  } catch (err) {
    sourceBridge?.close();
    clearPending();
    sendLog(mainWindow, `ERROR: no se pudo iniciar ffmpeg (${err.message}).`);
    return { ok: false, reason: 'spawn-failed' };
  }

  state.session = session;
  clearPending();

  predecodeTracks(session, mainWindow, config);
  wireEncoderProcessEvents(mainWindow, session.encoderProcess, sourceBridge);

  await wait(700);

  if (state.session !== session || session.encoderProcess.exitCode !== null) {
    sendLog(mainWindow, 'ERROR: FFmpeg termino inmediatamente al conectar. Revisa credenciales, mountpoint, y que ffmpeg.exe este en resources/ffmpeg/.');
    session.sourceBridge?.close();
    if (state.session === session) state.session = null;
    return { ok: false, reason: 'ffmpeg-exit' };
  }

  sendLog(mainWindow, 'Encoder FFmpeg iniciado correctamente.');
  session.startedAt = Date.now();
  startStatusTicker();
  // El grabador arranca en el siguiente turno: Documents, el spawn o un
  // antivirus no pueden bloquear el boton Iniciar.
  setImmediate(() => {
    if (state.session === session && !session.stopRequested) startLocalRecorder(mainWindow);
  });

  runIntroThenLive(mainWindow).catch((err) => {
    sendLog(mainWindow, `Error en la secuencia de inicio: ${err.message}`);
  });

  return { ok: true };
}

async function runIntroThenLive(mainWindow) {
  const session = state.session;
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
        session.introPcmPromise = null;
        if (!pcm) pcm = await decodeToPcm(introPath);
        if (state.session !== session || session.stopRequested) return;
        sendLog(mainWindow, 'Reproduciendo intro...');
        const { promise, abort } = playTimedPcm(pcm, {
          onChunk: writeToOutputs,
          onProgress: (elapsed, duration) => sendIntroProgress(mainWindow, { elapsedSeconds: elapsed, durationSeconds: duration })
        });
        session.introController = { abort };
        await promise;
        session.introController = null;
        sendIntroProgress(mainWindow, { done: true });
      } catch (err) {
        sendLog(mainWindow, `ERROR reproduciendo intro: ${err.message}`);
        sendIntroProgress(mainWindow, { done: true });
      }
    } else {
      sendLog(mainWindow, 'Intro activado pero no hay ninguna pista seleccionada en Configuracion.');
    }
  }

  if (state.session !== session || session.stopRequested) return;
  beginLiveCapture(mainWindow);
}

function beginLiveCapture(mainWindow) {
  const session = state.session;
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

  // Hot path de audio: UNA copia por bloque (naudiodon reutiliza su buffer),
  // ganancia en sitio y encolado. Todo lo demas (vumetro, espectro, aire
  // muerto) cuelga de pushLiveChunk con su propia limitacion de frecuencia.
  inputStream.on('data', (chunk) => {
    if (state.session !== session) return;
    const phase = session.phase;
    if (phase === 'paused') {
      // Mantiene vivos encoder y fuente remota enviando silencio PCM.
      writeToOutputs(getSilence(chunk.length));
      return;
    }
    if (phase !== 'live' && phase !== 'reconnecting') return;

    const owned = copyChunk(chunk);
    applyGainInPlace(owned, session.gain);
    writeToOutputs(owned);
    pushLiveChunk(session, owned, Date.now());
  });

  inputStream.on('error', (err) => {
    sendLog(mainWindow, `ERROR de captura de audio: ${err.message}`);
  });

  inputStream.start();
}

// ---------------------------------------------------------------------------
// Pausar/Reanudar: la conexion sigue viva y el micrófono se sustituye por silencio.
// ---------------------------------------------------------------------------
function togglePauseStream(mainWindow) {
  const session = state.session;
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
// Detener: (outro opcional con corte a -2s) -> cerrar conexion real
// ---------------------------------------------------------------------------
async function playOutro(mainWindow, session) {
  const config = session.config;
  const outroPath = config.outroEnabled && config.outroTrackId ? libraryManager.getTrackPath(config.outroTrackId) : null;
  if (!outroPath) {
    sendLog(mainWindow, 'Outro no configurado; cerrando la conexion.');
    return;
  }

  sendStatus(mainWindow, 'outro', elapsedSeconds());
  sendLog(mainWindow, `Reproduciendo outro; la conexion se cerrara ${OUTRO_CUTOFF_SECONDS}s antes de que termine.`);
  try {
    let pcm = session.outroPcmPromise ? await session.outroPcmPromise : null;
    session.outroPcmPromise = null;
    if (!pcm) pcm = await decodeToPcm(outroPath);
    const cutoffSeconds = Math.max(0, pcm.length / BYTES_PER_SECOND - OUTRO_CUTOFF_SECONDS);
    const { promise, abort } = playTimedPcm(pcm, {
      onChunk: writeToOutputs,
      onProgress: (elapsed, duration) => sendOutroProgress(mainWindow, { elapsedSeconds: elapsed, durationSeconds: duration }),
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
}

async function stopStream(mainWindow, options = {}) {
  if (!state.session && state.pendingStart) {
    state.pendingStart.stopRequested = true;
    state.pendingStart.sourceBridge?.close();
    state.pendingStart = null;
    sendIntroProgress(mainWindow, { done: true });
    sendLog(mainWindow, 'Conexión detenida mientras se autenticaba con el proveedor.');
    sendStatus(mainWindow, 'idle', 0);
    return { ok: true };
  }

  const session = state.session;
  if (!session) {
    sendLog(mainWindow, 'No hay ninguna transmision activa para detener.');
    return { ok: false, reason: 'not-streaming' };
  }

  session.stopRequested = true;
  if (options.promptRecording === false) session.recordingSavePrompt = false;
  const phaseAtStop = session.phase;

  if (phaseAtStop === 'connecting' || phaseAtStop === 'intro' || phaseAtStop === 'reconnecting') {
    session.introController?.abort();
    sendIntroProgress(mainWindow, { done: true });
    releaseSessionInput(session);
    sendLog(mainWindow, phaseAtStop === 'reconnecting'
      ? 'Transmision detenida mientras se intentaba reconectar.'
      : 'Transmision detenida antes de llegar al audio en vivo.');
    await teardownSession(mainWindow, 'idle');
    return { ok: true };
  }

  if (phaseAtStop === 'live' || phaseAtStop === 'paused') {
    // Cambiar de fase ANTES de detener la captura: el guard del handler de
    // audio debe bloquear cualquier callback que dispare naudiodon al cerrar
    // (evita el eco/repeticion de la ultima palabra).
    session.phase = 'outro';
    releaseSessionInput(session);
    await playOutro(mainWindow, session);
  }

  await teardownSession(mainWindow, 'idle');
  return { ok: true };
}

function setGain(value) {
  if (state.session) state.session.gain = value;
}

/** Limpieza de emergencia al cerrar la app (evita procesos ffmpeg huerfanos). */
function shutdown() {
  stopPreview();
  const session = state.session;
  if (!session) return;
  stopStatusTicker();
  session.introController?.abort();
  session.outroController?.abort();
  if (session.inputStream) {
    try { session.inputStream.quit(() => {}); } catch { /* noop */ }
  }
  if (session.encoderProcess) killQuietly(session.encoderProcess);
  if (session.recorderProcess) killQuietly(session.recorderProcess);
  session.sourceBridge?.close();
  logHistoryEntry(session, 'app-closed');
  state.session = null;
  sendDeadAir(session.mainWindow, false);
}

function isStreaming() {
  return state.session !== null;
}

module.exports = { startStream, stopStream, togglePauseStream, setGain, shutdown, isStreaming };
