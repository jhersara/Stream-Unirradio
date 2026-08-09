const { autoUpdater } = require('electron-updater');

/**
 * Configura electron-updater contra los Releases de GitHub definidos en
 * package.json -> build.publish (owner/repo). Mientras esos valores sigan
 * en TODO_GITHUB_OWNER / TODO_GITHUB_REPO, esto no encontrara actualizaciones
 * reales, pero no rompe la app: solo se registra el error en consola.
 */
function initAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[auto-updater] Buscando actualizaciones...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] Actualizacion disponible:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[auto-updater] No hay actualizaciones disponibles.');
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-updater] Actualizacion descargada, se instalara al cerrar la app:', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] Error verificando actualizaciones:', err ? (err.stack || err.toString()) : 'desconocido');
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[auto-updater] No se pudo iniciar la verificacion:', err);
  });
}

module.exports = { initAutoUpdater };
