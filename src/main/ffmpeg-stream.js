const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
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
  sendOutroProgress,
  sendRecordingSaveState
} = require('./ipc-events');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
const MAX_PIPE_QUEUE_BYTES = BYTES_PER_SECOND * 2;
const MAX_OUTPUT_QUEUE_BYTES = BYTES_PER_SECOND * 2;
const OUTRO_CUTOFF_SECONDS = 2;
const CHUNK_MS = 50;
// Diez actualizaciones por segundo son suficientes para interpolar el vúmetro
// en el renderer y reducen el trabajo de IPC/FFT en equipos modestos.
const VU_EMIT_INTERVAL_MS = 100;
const SPECTRUM_FFT_SIZE = 512;
const SPECTRUM_BAND_COUNT = 24;
const RECONNECT_DELAYS_MS = [3000, 6000, 12000, 24000, 30000];
const SILENCE_PEAK_THRESHOLD = 0.02; // ~ -34dB: bajo pero no absoluto, evita falsos positivos
const DEAD_AIR_SECONDS = 15;

// Solo se soporta UNA sesion de transmision activa a la vez (coincide con el
// diseno de un unico boton Iniciar/Detener en la interfaz).
let session = null;
let pendingStart = null;
let pendingRecording = null;

// Prueba de microfono (fuera de una transmision real, ver startPreview).
let previewState = null;
let metricsWorker = null;
let nextMetricsId = 1;
const pendingMetrics = new Map();

function ensureMetricsWorker() {
  if (metricsWorker) return metricsWorker;
  const worker = new Worker(path.join(__dirname, 'audio-metrics-worker.js'));
  metricsWorker = worker;
  worker.on('message', (payload) => {
    const request = pendingMetrics.get(payload.id);
    if (!request) return;
    pendingMetrics.delete(payload.id);
    if (!session || session !== request.session || session.stopRequested || !payload.metrics) return;
    sendVuLevel(request.mainWindow, payload.metrics.peak, payload.metrics.db, payload.metrics);
    sendSpectrum(request.mainWindow, payload.spectrum || []);
    checkDeadAir(request.mainWindow, payload.metrics.peak, request.now);
  });
  worker.on('error', (error) => {
    pendingMetrics.clear();
    if (metricsWorker === worker) metricsWorker = null;
    if (session) sendLog(session.mainWindow, `Aviso: se desactivó el analizador de audio (${error.message}).`);
  });
  worker.on('exit', () => {
    if (metricsWorker === worker) metricsWorker = null;
  });
  worker.unref?.();
  return worker;
}

function requestLiveMetrics(mainWindow, chunk, now) {
  if (!session || pendingMetrics.size >= 2 || !chunk?.length) return;
  const worker = ensureMetricsWorker();
  const id = nextMetricsId++;
  const copy = Uint8Array.from(chunk);
  pendingMetrics.set(id, { mainWindow, now, session });
  try {
    worker.postMessage({ id, buffer: copy.buffer }, [copy.buffer]);
  } catch {
    pendingMetrics.delete(id);
  }
}

function stopMetricsWorker() {
  pendingMetrics.clear();
  if (metricsWorker) {
    metricsWorker.terminate().catch(() => {});
    metricsWorker = null;
  }
}

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

function flushEncoderQueue() {
  if (!session || !session.encoderProcess) return;
  const current = session;
  const stdin = current.encoderProcess.stdin;
  if (!stdin || stdin.destroyed) return;
  current.encoderDrainAttached = false;
  while (current.encoderQueue.length > 0 && !stdin.destroyed) {
    const next = current.encoderQueue.shift();
    current.encoderQueueBytes -= next.length;
    try {
      if (!stdin.write(next)) {
        current.encoderBackpressured = true;
        stdin.once('drain', () => {
          if (session === current) {
            current.encoderBackpressured = false;
            flushEncoderQueue();
          }
        });
        current.encoderDrainAttached = true;
        return;
      }
    } catch {
      current.encoderQueue.length = 0;
      current.encoderQueueBytes = 0;
      return;
    }
  }
  current.encoderBackpressured = false;
}

function writeToEncoder(chunk) {
  if (!session || !session.encoderProcess || !chunk?.length) return;
  const current = session;
  const stdin = current.encoderProcess.stdin;
  if (!stdin || stdin.destroyed) return;
  if (current.encoderBackpressured || current.encoderQueue.length > 0) {
    if (current.encoderQueueBytes + chunk.length <= MAX_PIPE_QUEUE_BYTES) {
      current.encoderQueue.push(chunk);
      current.encoderQueueBytes += chunk.length;
    } else if (!current.encoderQueueWarned) {
      current.encoderQueueWarned = true;
      sendLog(current.mainWindow, 'Aviso: el encoder está saturado; se limita la cola de audio para evitar que la aplicación consuma memoria sin límite.');
    }
    return;
  }
  try {
    if (!stdin.write(chunk)) {
      current.encoderBackpressured = true;
      if (!current.encoderDrainAttached) {
        current.encoderDrainAttached = true;
        stdin.once('drain', () => {
          if (session === current) {
            current.encoderBackpressured = false;
            flushEncoderQueue();
          }
        });
      }
    }
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

function flushRecorderQueue() {
  if (!session || !session.recorderProcess) return;
  const current = session;
  const stdin = current.recorderProcess.stdin;
  if (!stdin || stdin.destroyed) return;
  current.recorderDrainAttached = false;
  while (current.recorderQueue.length > 0 && !stdin.destroyed) {
    const next = current.recorderQueue.shift();
    current.recorderQueueBytes -= next.length;
    try {
      if (!stdin.write(next)) {
        current.recorderBackpressured = true;
        stdin.once('drain', () => {
          if (session === current) {
            current.recorderBackpressured = false;
            flushRecorderQueue();
          }
        });
        current.recorderDrainAttached = true;
        return;
      }
    } catch {
      current.recorderQueue.length = 0;
      current.recorderQueueBytes = 0;
      return;
    }
  }
  current.recorderBackpressured = false;
}

function writeToRecorder(chunk) {
  if (!session || !session.recorderProcess || !chunk?.length) return;
  const current = session;
  const stdin = current.recorderProcess.stdin;
  if (!stdin || stdin.destroyed) return;
  if (current.recorderBackpressured || current.recorderQueue.length > 0) {
    if (current.recorderQueueBytes + chunk.length <= MAX_PIPE_QUEUE_BYTES) {
      current.recorderQueue.push(chunk);
      current.recorderQueueBytes += chunk.length;
    } else if (!current.recorderBackpressureWarned) {
      current.recorderBackpressureWarned = true;
      sendLog(current.mainWindow, 'Aviso: la grabación local está más lenta; se limita su cola sin afectar la transmisión.');
    }
    return;
  }
  try {
    if (!stdin.write(chunk)) {
      current.recorderBackpressured = true;
      if (!current.recorderDrainAttached) {
        current.recorderDrainAttached = true;
        stdin.once('drain', () => {
          if (session === current) {
            current.recorderBackpressured = false;
            flushRecorderQueue();
          }
        });
      }
      if (!current.recorderBackpressureWarned) {
        current.recorderBackpressureWarned = true;
        sendLog(current.mainWindow, 'Aviso: la grabación local está procesando más lento; la transmisión en vivo no se detendrá.');
      }
    }
  } catch {
    // La grabacion local nunca debe afectar la transmision en vivo.
  }
}

/** Escribe el mismo audio al encoder (Icecast) y, si aplica, a la grabacion local. */
function pumpOutputQueue(current) {
  if (!current || session !== current) return;
  current.outputPumpScheduled = false;
  const startedAt = Date.now();
  while (current.outputQueue.length > 0 && Date.now() - startedAt < 5) {
    const chunk = current.outputQueue.shift();
    current.outputQueueBytes -= chunk.length;
    writeToEncoder(chunk);
    writeToRecorder(chunk);
  }
  if (current.outputQueue.length > 0 && session === current) {
    current.outputPumpScheduled = true;
    setImmediate(() => pumpOutputQueue(current));
  }
}

function writeToOutputs(chunk) {
  if (!session || !chunk?.length) return;
  const current = session;
  if (current.outputQueueBytes + chunk.length <= MAX_OUTPUT_QUEUE_BYTES) {
    // El buffer recibido por naudiodon puede reutilizarse después del callback;
    // se copia una sola vez y el trabajo de tuberías ocurre fuera del callback.
    current.outputQueue.push(Buffer.from(chunk));
    current.outputQueueBytes += chunk.length;
  } else if (!current.outputQueueWarned) {
    current.outputQueueWarned = true;
    sendLog(current.mainWindow, 'Aviso: la salida de audio está saturada; se limita la cola para proteger la memoria y mantener viva la interfaz.');
  }
  if (!current.outputPumpScheduled) {
    current.outputPumpScheduled = true;
    setImmediate(() => pumpOutputQueue(current));
  }
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
    '-y', '-hide_banner', '-loglevel', 'warning', '-threads', '1',
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '128k',
    outputPath
  ];
}

function buildRecordingFileStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function buildDefaultRecordingPath(stamp = buildRecordingFileStamp()) {
  // Documents puede estar redirigido a OneDrive y bloquear operaciones de
  // archivos durante segundos. La carpeta predeterminada vive en userData,
  // siempre local; el usuario aún puede elegir otra carpeta desde el overlay.
  const dir = path.join(app.getPath('userData'), 'Stream Radio - Grabaciones');
  return path.join(dir, `transmision-${stamp}.mp3`);
}

function withFileTimeout(operation, label, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} tardó demasiado`)), timeoutMs);
    Promise.resolve(operation).then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function buildTemporaryRecordingPath(stamp = buildRecordingFileStamp()) {
  const dir = path.join(app.getPath('temp'), 'Stream Radio - Grabaciones temporales');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `transmision-${stamp}-${process.pid}.partial.mp3`);
}

function ensureMp3Extension(filePath) {
  return /\.mp3$/i.test(filePath) ? filePath : `${filePath}.mp3`;
}

function sanitizeRecordingName(value) {
  const cleaned = String(value || 'grabacion')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.mp3$/i, '')
    .slice(0, 120);
  return cleaned || 'grabacion';
}

function buildRecordingDestination(folder, name, fallbackPath) {
  const safeFolder = String(folder || '').trim() || path.dirname(fallbackPath);
  const safeName = sanitizeRecordingName(name || path.basename(fallbackPath, '.mp3'));
  return ensureMp3Extension(path.join(safeFolder, safeName));
}

async function moveRecordingFile(sourcePath, destinationPath) {
  if (!sourcePath) return null;
  try {
    await withFileTimeout(fs.promises.access(sourcePath, fs.constants.R_OK), 'Acceso al archivo temporal');
  } catch (err) {
    return null;
  }
  const destination = ensureMp3Extension(destinationPath);
  await withFileTimeout(fs.promises.mkdir(path.dirname(destination), { recursive: true }), 'Creación de carpeta de grabación');

  // El selector ya confirmó la sobreescritura si el usuario eligió un archivo
  // existente. Eliminarlo antes del rename hace que Windows se comporte igual
  // que los demás sistemas sin bloquear el proceso principal.
  if (path.resolve(sourcePath) !== path.resolve(destination)) {
    await withFileTimeout(fs.promises.rm(destination, { force: true }), 'Eliminación del destino anterior');
  }

  try {
    await withFileTimeout(fs.promises.rename(sourcePath, destination), 'Movimiento de la grabación');
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // copyFile/unlink usan el pool de libuv: una copia grande entre discos no
    // congela el hilo principal ni la interfaz de Electron.
    await withFileTimeout(fs.promises.copyFile(sourcePath, destination), 'Copia de la grabación');
    await withFileTimeout(fs.promises.unlink(sourcePath), 'Limpieza del temporal');
  }
  return destination;
}

function prepareRecordingSave(mainWindow, finishedSession) {
  if (!finishedSession?.recordingRequested || !finishedSession.recordingTempPath) return null;
  const defaultPath = buildDefaultRecordingPath(finishedSession.recordingStamp);
  pendingRecording = { mainWindow, finishedSession, defaultPath };
  sendRecordingSaveState(mainWindow, {
    state: 'ready',
    defaultPath,
    defaultName: path.basename(defaultPath, '.mp3'),
    defaultFolder: path.dirname(defaultPath),
    message: finishedSession.recordingSavePrompt === false
      ? 'Guardando automáticamente en la carpeta predeterminada…'
      : 'Selecciona el nombre y la carpeta de la grabación.'
  });
  return defaultPath;
}

async function chooseRecordingFolder(mainWindow) {
  if (!pendingRecording || !mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'no-pending-recording' };
  const { dialog } = require('electron');
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar carpeta de grabación',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
    return { ok: true, folder: result.filePaths[0] };
  } catch (err) {
    sendLog(mainWindow, `Aviso: no se pudo seleccionar la carpeta (${err.message}).`);
    return { ok: false, reason: 'folder-selection-failed' };
  }
}

async function savePendingRecording(mainWindow, options = {}) {
  if (!pendingRecording) return { ok: false, reason: 'no-pending-recording' };
  const current = pendingRecording;
  pendingRecording = null;
  const { finishedSession, defaultPath } = current;
  try {
    await fs.promises.access(finishedSession.recordingTempPath, fs.constants.R_OK);
  } catch {
    sendRecordingSaveState(mainWindow, { state: 'error', message: 'No se encontró el archivo temporal de la grabación.' });
    return { ok: false, reason: 'temp-file-missing' };
  }

  const destination = options.useDefault
    ? defaultPath
    : buildRecordingDestination(options.folder, options.name, defaultPath);
  sendRecordingSaveState(mainWindow, { state: 'saving', destination, message: 'Guardando grabación sin bloquear la emisión…' });
  try {
    const finalPath = await moveRecordingFile(finishedSession.recordingTempPath, destination);
    if (!finalPath) throw new Error('No se pudo mover el archivo temporal.');
    finishedSession.recordingPath = finalPath;
    sendRecordingSaveState(mainWindow, { state: 'saved', path: finalPath, message: 'Grabación guardada correctamente.' });
    sendLog(mainWindow, `Grabación guardada en: ${finalPath}`);
    logHistoryEntry(finishedSession, 'manual');
    return { ok: true, path: finalPath };
  } catch (err) {
    pendingRecording = current;
    sendRecordingSaveState(mainWindow, { state: 'error', message: `No se pudo guardar la grabación: ${err.message}` });
    sendLog(mainWindow, `Aviso: no se pudo mover la grabación a ${destination} (${err.message}).`);
    return { ok: false, reason: 'save-failed', message: err.message };
  }
}

function startLocalRecorder(mainWindow) {
  if (!session || !session.recordingRequested || session.stopRequested) return;
  try {
    const recordingStamp = buildRecordingFileStamp();
    const recordingTempPath = buildTemporaryRecordingPath(recordingStamp);
    const recorderProcess = spawn(resolveFfmpegPath(), buildRecorderArgs(recordingTempPath), { windowsHide: true });
    session.recorderProcess = recorderProcess;
    session.recordingTempPath = recordingTempPath;
    session.recordingPath = recordingTempPath;
    session.recordingStamp = recordingStamp;
    session.recorderBackpressured = false;
    session.recorderBackpressureWarned = false;
    wireRecorderProcessEvents(mainWindow, recorderProcess);
    sendLog(mainWindow, 'Grabación local iniciada. Al finalizar podrás elegir el nombre y la carpeta de destino.');
  } catch (err) {
    sendLog(mainWindow, `Aviso: no se pudo iniciar la grabación local (${err.message}). La transmisión sigue normal.`);
    session.recordingRequested = false;
  }
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

// El archivo local es secundario frente a la emisión. En Windows, esperar a
// que una tubería stdin con backpressure acepte EOF puede dejar una promesa IPC
// abierta indefinidamente. Para el recorder se prioriza liberar el hilo del
// main y se solicita el cierre mediante un proceso taskkill desacoplado: llamar
// proc.kill() de forma síncrona puede bloquear Electron mientras FFmpeg aún
// tiene datos en sus pipes.
function requestProcessTermination(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32' && proc.pid) {
    try {
      const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore'
      });
      killer.unref?.();
      return;
    } catch { /* noop */ }
  }
  try { proc.kill(); } catch { /* noop */ }
}

function stopRecorderQuickly(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 1000);
    proc.once('close', finish);
    try {
      if (proc.stdin && !proc.stdin.destroyed) proc.stdin.destroy();
    } catch { /* noop */ }
    requestProcessTermination(proc);
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
  let lastLogAt = 0;
  let suppressed = 0;
  recorderProcess.stderr.on('data', (chunk) => {
    const now = Date.now();
    chunk.toString().split('\n').forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      if (now - lastLogAt < 500) {
        suppressed += 1;
        return;
      }
      const suffix = suppressed > 0 ? ` (${suppressed} mensajes repetidos omitidos)` : '';
      suppressed = 0;
      lastLogAt = now;
      sendLog(mainWindow, `Grabacion: ${line}${suffix}`);
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

function releaseInputStream(inputStream) {
  if (!inputStream) return;
  setImmediate(() => {
    try { inputStream.quit(() => {}); } catch { /* noop */ }
  });
}

function stopPreview() {
  if (!previewState) return { ok: true };
  const inputStream = previewState.inputStream;
  previewState = null;
  releaseInputStream(inputStream);
  return { ok: true };
}

function isPreviewing() {
  return previewState !== null;
}

// ---------------------------------------------------------------------------
// Secuencia: conectar -> (intro) -> vivo
// ---------------------------------------------------------------------------
async function startStream(mainWindow, rawConfig) {
  if (pendingRecording) {
    sendLog(mainWindow, 'Primero guarda la grabación pendiente antes de iniciar otra transmisión.');
    return { ok: false, reason: 'recording-save-pending' };
  }
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
    recordingTempPath: null,
    recordingStamp: null,
    recordingSavePrompt: config.recordingSavePrompt !== false && config.scheduled !== true,
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
    recordingRequested: Boolean(config.recordSession),
    recorderBackpressured: false,
    recorderBackpressureWarned: false,
    recorderQueue: [],
    recorderQueueBytes: 0,
    recorderDrainAttached: false,
    encoderBackpressured: false,
    encoderQueue: [],
    encoderQueueBytes: 0,
    encoderDrainAttached: false,
    encoderQueueWarned: false,
    outputQueue: [],
    outputQueueBytes: 0,
    outputQueueWarned: false,
    outputPumpScheduled: false
  };
  pendingStart = null;

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
  // El grabador se inicia en el siguiente turno del event loop, después de
  // devolver el control al flujo de emisión. Así Documents, el spawn de
  // FFmpeg o un antivirus no pueden bloquear el botón Iniciar.
  setImmediate(() => {
    if (session && !session.stopRequested) startLocalRecorder(mainWindow);
  });

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
      requestLiveMetrics(mainWindow, gained, now);
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
async function stopStream(mainWindow, options = {}) {
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
  if (options.promptRecording === false) session.recordingSavePrompt = false;
  const phaseAtStop = session.phase;

  if (phaseAtStop === 'connecting' || phaseAtStop === 'intro' || phaseAtStop === 'reconnecting') {
    if (session.introController) session.introController.abort();
    sendIntroProgress(mainWindow, { done: true });
    if (session.inputStream) {
      releaseInputStream(session.inputStream);
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
      releaseInputStream(session.inputStream);
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

  // El encoder de emisión tiene prioridad: se espera solo a su cierre ordenado.
  // El grabador local se finaliza en un turno posterior del event loop. Es
  // deliberado: stdin.end() puede encontrar una tubería con backpressure y no
  // debe ejecutarse dentro del handler IPC que responde al botón Detener.
  const recordingActive = Boolean(finishedSession?.recordingRequested && finishedSession.recordingTempPath);
  if (recordingActive) {
    sendRecordingSaveState(mainWindow, { state: 'processing', message: 'La transmisión terminó; finalizando la grabación en segundo plano…' });
  }

  const encoderDone = gracefullyEndProcess(finishedSession ? finishedSession.encoderProcess : null, 1800);
  await encoderDone;

  sendDeadAir(mainWindow, false);
  sendStatus(mainWindow, finalStatusKind, 0);
  sendLog(mainWindow, 'Transmisión finalizada. Desconectado del servidor.');

  if (recordingActive) {
    setImmediate(() => {
      void stopRecorderQuickly(finishedSession.recorderProcess).then(() => {
        const defaultPath = prepareRecordingSave(mainWindow, finishedSession);
        if (finishedSession.recordingSavePrompt === false && defaultPath) {
          return savePendingRecording(mainWindow, { useDefault: true });
        }
        return null;
      }).catch((err) => {
        sendRecordingSaveState(mainWindow, { state: 'error', message: `No se pudo finalizar la grabación: ${err.message}` });
        finishedSession.recordingPath = finishedSession.recordingTempPath;
        logHistoryEntry(finishedSession, 'manual');
      });
    });
  } else {
    logHistoryEntry(finishedSession, 'manual');
  }
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
  stopMetricsWorker();
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
  chooseRecordingFolder,
  savePendingRecording,
  startPreview,
  stopPreview,
  isPreviewing
};
