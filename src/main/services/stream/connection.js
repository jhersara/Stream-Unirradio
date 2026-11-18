const { spawn } = require('child_process');
const state = require('./state');
const { RECONNECT_DELAYS_MS } = require('./constants');
const { wait, elapsedSeconds } = require('./status');
const { handleUnexpectedTermination } = require('./teardown');
const { resolveFfmpegPath } = require('../media/probe');
const radioProviders = require('../providers/radio-providers');
const { ShoutcastSourceBridge } = require('../providers/shoutcast-source');
const { killQuietly } = require('../../utils/process');
const { sendLog, sendStatus } = require('../../ipc/events');

/** Traduce lineas de stderr de ffmpeg conocidas a un diagnostico entendible. */
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

function buildStreamProfile(config) {
  const validation = radioProviders.validateConfig(config);
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  return radioProviders.buildEncoderProfile(config);
}

async function connectSourceBridge(mainWindow, profile, config) {
  if (!profile || profile.outputMode !== 'shoutcast-source') return null;
  const bridge = new ShoutcastSourceBridge({ ...config, streamId: profile.streamId });
  if (state.pendingStart) state.pendingStart.sourceBridge = bridge;
  try {
    await bridge.connect();
    sendLog(mainWindow, `Handshake SHOUTcast completado en ${profile.sourceHost}:${profile.sourcePort}.`);
    return bridge;
  } catch (err) {
    bridge.close();
    throw err;
  }
}

function writeEncodedOutput(chunk) {
  const session = state.session;
  if (!session || !session.sourceBridge) return;
  const bridge = session.sourceBridge;
  if (bridge.write(chunk)) return;
  const stdout = session.encoderProcess?.stdout;
  if (stdout && !stdout.isPaused()) {
    stdout.pause();
    bridge.once('drain', () => {
      if (state.session && state.session.sourceBridge === bridge && state.session.encoderProcess?.stdout) {
        state.session.encoderProcess.stdout.resume();
      }
    });
  }
}

function dropEncoder(mainWindow, bridge) {
  const session = state.session;
  session.sourceBridge = null;
  const encoder = session.encoderProcess;
  if (encoder) {
    killQuietly(encoder);
    handleEncoderDrop(mainWindow, encoder);
  } else if (bridge) {
    handleUnexpectedTermination(mainWindow);
  }
}

function wireSourceBridgeEvents(mainWindow, bridge) {
  if (!bridge) return;
  bridge.on('error', (err) => {
    const session = state.session;
    if (!session || session.sourceBridge !== bridge || session.stopRequested) return;
    sendLog(mainWindow, `ERROR de fuente SHOUTcast: ${err.message}`);
    dropEncoder(mainWindow, bridge);
  });
  bridge.on('close', () => {
    const session = state.session;
    if (!session || session.sourceBridge !== bridge || session.stopRequested) return;
    sendLog(mainWindow, 'La fuente SHOUTcast cerró la conexión.');
    session.sourceBridge = null;
    const encoder = session.encoderProcess;
    if (encoder) {
      killQuietly(encoder);
      handleEncoderDrop(mainWindow, encoder);
    }
  });
}

function wireEncoderProcessEvents(mainWindow, encoderProcess, sourceBridge = null) {
  let lastLogAt = 0;
  let suppressed = 0;
  encoderProcess.stderr.on('data', (chunk) => {
    const now = Date.now();
    chunk.toString().split('\n').forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      if (now - lastLogAt < 250) {
        suppressed += 1;
        return;
      }
      const suffix = suppressed > 0 ? ` (${suppressed} mensajes repetidos omitidos)` : '';
      suppressed = 0;
      lastLogAt = now;
      sendLog(mainWindow, `FFmpeg: ${line}${suffix}`);
      const hint = interpretFfmpegLine(line);
      if (hint) sendLog(mainWindow, `Sugerencia: ${hint}`);
    });
  });

  if (sourceBridge && encoderProcess.stdout) {
    encoderProcess.stdout.on('data', writeEncodedOutput);
    wireSourceBridgeEvents(mainWindow, sourceBridge);
  }

  encoderProcess.on('error', (err) => {
    sendLog(mainWindow, `ERROR de FFmpeg: ${err.message}`);
    handleEncoderDrop(mainWindow, encoderProcess);
  });

  encoderProcess.on('close', (code) => {
    const session = state.session;
    if (!session || session.encoderProcess !== encoderProcess || session.stopRequested) return;
    sendLog(mainWindow, `ERROR: FFmpeg se cerro inesperadamente (codigo ${code}).`);
    handleEncoderDrop(mainWindow, encoderProcess);
  });
}

/** Lanza ffmpeg con el perfil y lo conecta al escritor de la sesion. */
function spawnEncoder(profile, session) {
  const encoderProcess = spawn(resolveFfmpegPath(), profile.args, { windowsHide: true });
  session.encoderWriter.attach(encoderProcess.stdin);
  return encoderProcess;
}

/**
 * El encoder murio sin que el usuario lo pidiera. En 'live'/'paused'/'intro'
 * se reconecta solo; durante 'connecting' lo maneja startStream.
 */
function handleEncoderDrop(mainWindow, encoderProcess) {
  const session = state.session;
  if (!session || session.encoderProcess !== encoderProcess || session.stopRequested) return;
  if (session.phase === 'live' || session.phase === 'paused' || session.phase === 'intro') {
    attemptReconnect(mainWindow);
  } else if (session.phase !== 'connecting') {
    handleUnexpectedTermination(mainWindow);
  }
}

/**
 * Reconexion automatica con espera creciente. La captura de microfono y la
 * grabacion local siguen durante los reintentos: solo se quedan sin encoder.
 */
async function attemptReconnect(mainWindow) {
  let session = state.session;
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
  session = state.session;
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
  if (!state.session || state.session.stopRequested) {
    sourceBridge?.close();
    return;
  }

  sendLog(mainWindow, `Reintentando conexion con ${profile.provider.label} en ${config.server}:${config.port} (intento ${attempt}/${RECONNECT_DELAYS_MS.length})...`);

  let encoderProcess;
  try {
    encoderProcess = spawnEncoder(profile, session);
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
  if (!state.session || state.session.stopRequested) return;

  if (state.session.encoderProcess !== encoderProcess || encoderProcess.exitCode !== null) {
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

module.exports = {
  interpretFfmpegLine,
  buildStreamProfile,
  connectSourceBridge,
  spawnEncoder,
  wireEncoderProcessEvents,
  handleEncoderDrop,
  attemptReconnect
};
