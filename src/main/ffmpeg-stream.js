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

      // Los bytes a enviar se calculan segun el TIEMPO REAL transcurrido
      // (Date.now() - startTime), no segun un contador fijo de "ticks" de
      // CHUNK_MS. setTimeout en Node no garantiza precision: si el event
      // loop se congestiona un momento (GC, IPC, disco), un tick puede
      // llegar tarde. Con un chunk de tamano fijo por tick, ese retraso se
      // traduce en un hueco real de audio (silencio/corte) porque el
      // encoder se queda sin datos mientras tanto. Calculando el objetivo
      // por tiempo real, el siguiente tick manda un chunk mas grande para
      // "ponerse al dia", sin dejar huecos.
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
    outroController: null,
    introPcmPromise: null,
    outroPcmPromise: null
  };

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
        let pcm = session.introPcmPromise ? await session.introPcmPromise : null;
        if (!pcm) {
          pcm = await decodeToPcm(introPath);
        }
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

  // Limitar el envio de nivel de vumetro por IPC (no en cada callback de
  // audio, que puede llegar decenas de veces por segundo). Mandar un
  // mensaje IPC en cada callback compite por el mismo hilo de JS que debe
  // seguir escribiendole al pipe de ffmpeg a tiempo real; si ese hilo se
  // atrasa, naudiodon puede terminar reenviando/repitiendo audio del
  // buffer interno para compensar, lo que se escucha como un eco/repeticion
  // en la transmision. 15 actualizaciones/seg siguen siendo fluidas para el
  // ojo humano y le quitan presion al hot path de audio.
  const VU_EMIT_INTERVAL_MS = 66;
  let lastVuEmit = 0;

  inputStream.on('data', (chunk) => {
    if (!session || session.phase !== 'live') return;
    const gained = applyGain(chunk, session.gain);
    writeToEncoder(gained);

    const now = Date.now();
    if (now - lastVuEmit >= VU_EMIT_INTERVAL_MS) {
      lastVuEmit = now;
      const { peak, db } = computePeakDb(gained);
      sendVuLevel(mainWindow, peak, db);
    }
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
    const proc = session ? session.encoderProcess : null;
    session = null;

    function finish() {
      sendStatus(mainWindow, finalStatusKind, 0);
      sendLog(mainWindow, 'Transmision finalizada. Desconectado del servidor.');
      resolve();
    }

    if (!proc || proc.exitCode !== null) {
      finish();
      return;
    }

    // IMPORTANTE: no matar el proceso de inmediato. Si lo matamos (SIGTERM)
    // al mismo tiempo que cerramos stdin, ffmpeg no alcanza a vaciar el
    // encoder ni a cerrar la conexion TCP hacia Icecast de forma limpia.
    // Zeno.fm interpreta ese corte abrupto quedandose con el ultimo trozo
    // de audio en su buffer y lo repite en bucle para los oyentes durante
    // varios segundos hasta que detecta que la fuente ya no responde. Por
    // eso: cerramos stdin (EOF), le damos un plazo para que termine solo
    // (lo cual manda un cierre de conexion correcto), y solo si no sale a
    // tiempo lo forzamos como ultimo recurso.
    let settled = false;
    const graceTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch { /* noop */ }
      finish();
    }, 2500);

    proc.once('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      finish();
    });

    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.end();
      } else {
        clearTimeout(graceTimer);
        settled = true;
        try { proc.kill(); } catch { /* noop */ }
        finish();
      }
    } catch {
      clearTimeout(graceTimer);
      settled = true;
      try { proc.kill(); } catch { /* noop */ }
      finish();
    }
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
