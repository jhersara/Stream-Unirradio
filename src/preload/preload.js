const { contextBridge, ipcRenderer } = require('electron');

/**
 * Superficie expuesta al renderer. El renderer nunca toca ipcRenderer ni
 * ningun modulo de Node directamente (contextIsolation activo).
 */
contextBridge.exposeInMainWorld('streamAPI', {
  startStream: (config) => ipcRenderer.invoke('stream:start', config),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  setGain: (value) => ipcRenderer.invoke('stream:set-gain', value),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  // Prueba de microfono (fuera de una transmision real)
  startPreview: (deviceId) => ipcRenderer.invoke('stream:preview-start', deviceId),
  stopPreview: () => ipcRenderer.invoke('stream:preview-stop'),

  // Biblioteca persistente de pistas (unificada: sin categoria fija de
  // intro/outro a nivel de almacenamiento; importTracks admite seleccion
  // multiple de archivos en un solo dialogo).
  listLibrary: () => ipcRenderer.invoke('library:list'),
  importTracks: () => ipcRenderer.invoke('library:import'),
  deleteTrack: (id) => ipcRenderer.invoke('library:delete', id),

  // Configuracion persistida (servidor, credenciales, pistas activas)
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Actualizaciones (boton manual + popup/insignia en la barra lateral)
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  restartToUpdate: () => ipcRenderer.invoke('updates:restart'),

  // Historial de transmisiones
  listHistory: () => ipcRenderer.invoke('history:list'),
  revealRecording: (filePath) => ipcRenderer.invoke('history:reveal-recording', filePath),

  onLog: (callback) => subscribe('stream:log', callback),
  onStatus: (callback) => subscribe('stream:status', callback),
  onVuLevel: (callback) => subscribe('stream:vu-level', callback),
  onPreviewVuLevel: (callback) => subscribe('stream:preview-vu-level', callback),
  onIntroProgress: (callback) => subscribe('stream:intro-progress', callback),
  onOutroProgress: (callback) => subscribe('stream:outro-progress', callback),
  onUpdateState: (callback) => subscribe('app:update-state', callback)
});

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
