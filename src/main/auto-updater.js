const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { sendLog, sendUpdateState } = require('./ipc-events');

let lastUpdateState = { state: 'idle' };

function publishUpdateState(mainWindow, payload) {
  lastUpdateState = { ...payload, updatedAt: Date.now() };
  sendUpdateState(mainWindow, payload);
}

function getLastUpdateState() {
  return { ...lastUpdateState };
}

/**
 * Configura electron-updater contra los Releases de GitHub definidos en
 * package.json -> build.publish (owner: jhersara, repo: Stream-Unirradio).
 *
 * Ademas del log de texto (consola de actividad), emite 'app:update-state'
 * con un estado estructurado que el renderer usa para: mostrar un popup
 * cuando hay una actualizacion disponible/lista, y dejar una insignia
 * persistente en la barra lateral si el usuario cierra el popup sin actuar
 * (igual patron que usa la app de escritorio de Claude).
 *
 * En modo desarrollo (`npm start`, sin empaquetar) NO se verifica
 * automaticamente al arrancar: electron-updater necesita el archivo
 * `app-update.yml` que solo genera electron-builder al empaquetar. El
 * boton "Buscar actualizaciones" (vista Informacion) sigue funcionando en
 * dev para poder probar el flujo manualmente si hace falta.
 */
function initAutoUpdater(mainWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[auto-updater] Buscando actualizaciones...');
    sendLog(mainWindow, 'Buscando actualizaciones...');
      publishUpdateState(mainWindow, { state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] Actualizacion disponible:', info.version);
    sendLog(mainWindow, `Actualizacion disponible: v${info.version}. Descargando en segundo plano...`);
    publishUpdateState(mainWindow, { state: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    publishUpdateState(mainWindow, {
      state: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[auto-updater] No hay actualizaciones disponibles.');
    sendLog(mainWindow, `Ya tienes la ultima version instalada (v${app.getVersion()}).`);
    publishUpdateState(mainWindow, { state: 'not-available' });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-updater] Actualizacion descargada, se instalara al cerrar la app:', info.version);
    sendLog(mainWindow, `Actualizacion v${info.version} descargada. Lista para instalar.`);
    publishUpdateState(mainWindow, { state: 'downloaded', version: info.version, total: info.files?.[0]?.size || 0 });
  });

  autoUpdater.on('error', (err) => {
    const message = err ? (err.message || err.stack || err.toString()) : 'desconocido';
    console.error('[auto-updater] Error verificando actualizaciones:', message);
    sendLog(mainWindow, `Actualización: ${message}`);
    publishUpdateState(mainWindow, { state: 'error', message });
  });

  if (app.isPackaged) {
    checkNow(mainWindow);
  } else {
    console.log('[auto-updater] Modo desarrollo: se omite la verificacion automatica al iniciar.');
  }
}

/**
 * Dispara una verificacion manual (usado por el boton "Buscar
 * actualizaciones" y por la verificacion automatica al arrancar). A
 * diferencia de los listeners de arriba (silenciosos en dev), aqui SI se
 * refleja un error en el log de la app si la verificacion manual falla,
 * porque el usuario acaba de pedir explicitamente una respuesta.
 */
function checkNow(mainWindow) {
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    const message = err && (err.message || err.toString()) ? (err.message || err.toString()) : 'Error desconocido';
    console.error('[auto-updater] No se pudo verificar actualizaciones:', err);
    sendLog(mainWindow, `No se pudo verificar actualizaciones: ${message}`);
    publishUpdateState(mainWindow, { state: 'error', message });
  });
}

/**
 * Cierra la app e instala la actualizacion ya descargada (boton "Reiniciar
 * app" del popup/insignia). No hace nada si todavia no hay nada descargado
 * -- electron-updater simplemente ignora la llamada en ese caso.
 */
function restartToUpdate() {
  autoUpdater.quitAndInstall();
}

module.exports = { initAutoUpdater, checkNow, restartToUpdate, getLastUpdateState };
