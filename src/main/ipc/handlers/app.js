const { ipcMain, app, shell } = require('electron');
const settingsStore = require('../../stores/settings');
const scheduleStore = require('../../stores/schedule');
const historyStore = require('../../stores/history');
const radioProviders = require('../../services/providers/radio-providers');
const autoUpdater = require('../../services/updater/auto-updater');

/** Configuracion, proveedores, programacion, historial, actualizaciones y ventana. */
function registerAppHandlers(getWindow) {
  ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion() }));

  ipcMain.handle('settings:load', () => settingsStore.loadSettings());
  ipcMain.handle('settings:save', (event, settings) => {
    settingsStore.saveSettings(settings);
    return { ok: true };
  });
  ipcMain.handle('providers:list', () => radioProviders.listProviders());

  ipcMain.handle('schedule:load', () => scheduleStore.loadSchedule());
  ipcMain.handle('schedule:save', (event, schedule) => scheduleStore.saveSchedule(schedule));

  ipcMain.handle('history:list', () => historyStore.listSessions());
  ipcMain.handle('history:reveal-recording', (event, filePath) => {
    if (filePath) shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle('updates:check', () => {
    autoUpdater.checkNow(getWindow);
    return { ok: true };
  });
  ipcMain.handle('updates:state', () => autoUpdater.getLastUpdateState());
  ipcMain.handle('updates:restart', () => {
    autoUpdater.restartToUpdate(getWindow);
    return { ok: true };
  });

  // Modo mini-ventana flotante (compacto, siempre encima).
  let isCompact = false;
  let previousBounds = null;
  ipcMain.handle('window:set-compact', (event, enabled) => {
    const mainWindow = getWindow();
    if (!mainWindow) return { compact: false };

    if (enabled && !isCompact) {
      previousBounds = mainWindow.getBounds();
      mainWindow.setMinimumSize(280, 120);
      mainWindow.setAlwaysOnTop(true, 'floating');
      mainWindow.setResizable(false);
      mainWindow.setBounds({ x: previousBounds.x, y: previousBounds.y, width: 300, height: 130 });
      isCompact = true;
    } else if (!enabled && isCompact) {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setResizable(true);
      mainWindow.setMinimumSize(640, 680);
      if (previousBounds) mainWindow.setBounds(previousBounds);
      isCompact = false;
    }
    return { compact: isCompact };
  });
}

module.exports = { registerAppHandlers };
