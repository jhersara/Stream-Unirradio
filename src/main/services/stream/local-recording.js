const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const state = require('./state');
const { SAMPLE_RATE, CHANNELS } = require('./constants');
const { resolveFfmpegPath } = require('../media/probe');
const { stopProcessQuickly } = require('../../utils/process');
const { logHistoryEntry } = require('./history-log');
const { sendLog, sendRecordingSaveState } = require('../../ipc/events');

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

// Documents puede estar en OneDrive y bloquear operaciones durante segundos:
// la carpeta predeterminada vive en userData (siempre local).
function buildDefaultRecordingPath(stamp = buildRecordingFileStamp()) {
  return path.join(app.getPath('userData'), 'Stream Radio - Grabaciones', `transmision-${stamp}.mp3`);
}

function buildTemporaryRecordingPath(stamp = buildRecordingFileStamp()) {
  const dir = path.join(app.getPath('temp'), 'Stream Radio - Grabaciones temporales');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `transmision-${stamp}-${process.pid}.partial.mp3`);
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

const ensureMp3Extension = (filePath) => (/\.mp3$/i.test(filePath) ? filePath : `${filePath}.mp3`);

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
  } catch {
    return null;
  }
  const destination = ensureMp3Extension(destinationPath);
  await withFileTimeout(fs.promises.mkdir(path.dirname(destination), { recursive: true }), 'Creación de carpeta de grabación');

  if (path.resolve(sourcePath) !== path.resolve(destination)) {
    await withFileTimeout(fs.promises.rm(destination, { force: true }), 'Eliminación del destino anterior');
  }

  try {
    await withFileTimeout(fs.promises.rename(sourcePath, destination), 'Movimiento de la grabación');
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await withFileTimeout(fs.promises.copyFile(sourcePath, destination), 'Copia de la grabación');
    await withFileTimeout(fs.promises.unlink(sourcePath), 'Limpieza del temporal');
  }
  return destination;
}

function prepareRecordingSave(mainWindow, finishedSession) {
  if (!finishedSession?.recordingRequested || !finishedSession.recordingTempPath) return null;
  const defaultPath = buildDefaultRecordingPath(finishedSession.recordingStamp);
  state.pendingRecording = { mainWindow, finishedSession, defaultPath };
  sendRecordingSaveState(mainWindow, {
    state: 'ready',
    defaultPath,
    defaultName: path.basename(defaultPath, '.mp3'),
    defaultFolder: path.dirname(defaultPath),
    message: finishedSession.recordingSavePrompt === false
      ? 'Guardando automáticamente en la carpeta predeterminada…'
      : 'Selecciona nombre y carpeta de la grabación.'
  });
  return defaultPath;
}

async function chooseRecordingFolder(mainWindow) {
  if (!state.pendingRecording || !mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'no-pending-recording' };
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
  if (!state.pendingRecording) return { ok: false, reason: 'no-pending-recording' };
  const current = state.pendingRecording;
  state.pendingRecording = null;
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
    state.pendingRecording = current;
    sendRecordingSaveState(mainWindow, { state: 'error', message: `No se pudo guardar la grabación: ${err.message}` });
    sendLog(mainWindow, `Aviso: no se pudo mover la grabación a ${destination} (${err.message}).`);
    return { ok: false, reason: 'save-failed', message: err.message };
  }
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
    const session = state.session;
    if (session && session.recorderProcess === recorderProcess) {
      session.recorderProcess = null;
      session.recorderWriter.detach();
    }
  });
}

function startLocalRecorder(mainWindow) {
  const session = state.session;
  if (!session || !session.recordingRequested || session.stopRequested) return;
  try {
    const recordingStamp = buildRecordingFileStamp();
    const recordingTempPath = buildTemporaryRecordingPath(recordingStamp);
    const recorderProcess = spawn(resolveFfmpegPath(), buildRecorderArgs(recordingTempPath), { windowsHide: true });
    session.recorderProcess = recorderProcess;
    session.recordingTempPath = recordingTempPath;
    session.recordingPath = recordingTempPath;
    session.recordingStamp = recordingStamp;
    session.recorderWriter.attach(recorderProcess.stdin);
    wireRecorderProcessEvents(mainWindow, recorderProcess);
    sendLog(mainWindow, 'Grabación local iniciada. Al finalizar podrás elegir el nombre y la carpeta de destino.');
  } catch (err) {
    sendLog(mainWindow, `Aviso: no se pudo iniciar la grabación local (${err.message}). La transmisión sigue normal.`);
    session.recordingRequested = false;
  }
}

/**
 * Cierra el grabador de una sesion terminada y deja la grabacion lista para
 * guardar. Corre en un turno posterior del event loop para que un stdin con
 * contrapresion no bloquee el handler IPC del boton Detener.
 */
function finalizeLocalRecording(mainWindow, finishedSession) {
  setImmediate(() => {
    void stopProcessQuickly(finishedSession.recorderProcess).then(() => {
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
}

module.exports = { startLocalRecorder, finalizeLocalRecording, chooseRecordingFolder, savePendingRecording };
