const { contextBridge, ipcRenderer } = require('electron');

/**
 * Superficie expuesta al renderer. El renderer nunca toca ipcRenderer ni
 * ningun modulo de Node directamente (contextIsolation activo).
 */
contextBridge.exposeInMainWorld('streamAPI', {
  startStream: (config) => ipcRenderer.invoke('stream:start', config),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  selectAudioFile: () => ipcRenderer.invoke('dialog:select-audio-file'),

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
