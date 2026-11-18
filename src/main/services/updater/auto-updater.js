const { app } = require('electron');
const { sendLog, sendUpdateState } = require('../../ipc/events');

let autoUpdater = null;
let lastUpdateState = { state: 'idle' };

function publishUpdateState(getWindow, payload) {
  lastUpdateState = { ...payload, updatedAt: Date.now() };
  sendUpdateState(getWindow(), payload);
}

function getLastUpdateState() {
  return { ...lastUpdateState };
}

/**
 * electron-updater se carga bajo demanda (es pesado y no hace falta para
 * arrancar). Configura el updater contra los Releases de GitHub de
 * package.json -> build.publish y emite 'app:update-state' al renderer.
 */
function ensureAutoUpdater(getWindow) {
  if (autoUpdater) return autoUpdater;
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendLog(getWindow(), 'Buscando actualizaciones...');
    publishUpdateState(getWindow, { state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendLog(getWindow(), `Actualizacion disponible: v${info.version}. Descargando en segundo plano...`);
    publishUpdateState(getWindow, { state: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    publishUpdateState(getWindow, {
      state: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendLog(getWindow(), `Ya tienes la ultima version instalada (v${app.getVersion()}).`);
    publishUpdateState(getWindow, { state: 'not-available' });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendLog(getWindow(), `Actualizacion v${info.version} descargada. Lista para instalar.`);
    publishUpdateState(getWindow, { state: 'downloaded', version: info.version, total: info.files?.[0]?.size || 0 });
  });

  autoUpdater.on('error', (err) => {
    const message = err ? (err.message || err.stack || err.toString()) : 'desconocido';
    sendLog(getWindow(), `Actualización: ${message}`);
    publishUpdateState(getWindow, { state: 'error', message });
  });

  return autoUpdater;
}

/** Verificacion automatica al arrancar (solo empaquetada; en dev se omite). */
function initAutoUpdater(getWindow) {
  if (app.isPackaged) checkNow(getWindow);
}

/** Verificacion manual (boton "Buscar actualizaciones"). */
function checkNow(getWindow) {
  ensureAutoUpdater(getWindow).checkForUpdatesAndNotify().catch((err) => {
    const message = err && (err.message || err.toString()) ? (err.message || err.toString()) : 'Error desconocido';
    sendLog(getWindow(), `No se pudo verificar actualizaciones: ${message}`);
    publishUpdateState(getWindow, { state: 'error', message });
  });
}

/** Cierra la app e instala la actualizacion ya descargada. */
function restartToUpdate(getWindow) {
  ensureAutoUpdater(getWindow).quitAndInstall();
}

module.exports = { initAutoUpdater, checkNow, restartToUpdate, getLastUpdateState };
