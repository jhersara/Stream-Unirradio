const { autoUpdater } = require('electron-updater');
const { sendLog } = require('./ipc-events');

/**
 * Configura electron-updater contra los Releases de GitHub definidos en
 * package.json -> build.publish (owner: jhersara, repo: Stream-Unirradio).
 * Ademas de loguear en consola (para depuracion con DevTools), refleja el
 * estado en la consola de actividad del renderer via sendLog, para que un
 * operador sin DevTools abiertas tambien vea que esta pasando.
 */
function initAutoUpdater(mainWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[auto-updater] Buscando actualizaciones...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] Actualizacion disponible:', info.version);
    sendLog(mainWindow, `Actualizacion disponible: v${info.version}. Descargando en segundo plano...`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[auto-updater] No hay actualizaciones disponibles.');
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-updater] Actualizacion descargada, se instalara al cerrar la app:', info.version);
    sendLog(mainWindow, `Actualizacion v${info.version} descargada. Se instalara la proxima vez que cierres la app.`);
  });

  autoUpdater.on('error', (err) => {
    const message = err ? (err.stack || err.toString()) : 'desconocido';
    console.error('[auto-updater] Error verificando actualizaciones:', message);
    // No se manda a sendLog: si no hay releases publicados todavia en GitHub
    // (caso normal en desarrollo), electron-updater reporta error aqui en
    // cada arranque, y eso ensuciaria el log del operador sin ser un
    // problema real de la app.
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[auto-updater] No se pudo iniciar la verificacion:', err);
  });
}

module.exports = { initAutoUpdater };
