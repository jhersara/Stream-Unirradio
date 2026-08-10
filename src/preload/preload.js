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

  // Biblioteca persistente de pistas (unificada: sin categoria fija de
  // intro/outro a nivel de almacenamiento; importTracks admite seleccion
  // multiple de archivos en un solo dialogo).
  listLibrary: () => ipcRenderer.invoke('library:list'),
  importTracks: () => ipcRenderer.invoke('library:import'),
  deleteTrack: (id) => ipcRenderer.invoke('library:delete', id),

  onLog: (callback) => subscribe('stream:log', callback),
  onStatus: (callback) => subscribe('stream:status', callback),
  onVuLevel: (callback) => subscribe('stream:vu-level', callback),
  onIntroProgress: (callback) => subscribe('stream:intro-progress', callback),
  onOutroProgress: (callback) => subscribe('stream:outro-progress', callback)
});

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
