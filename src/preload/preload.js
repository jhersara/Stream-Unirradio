const { contextBridge, ipcRenderer } = require('electron');

/**
 * Superficie expuesta al renderer. El renderer nunca toca ipcRenderer ni
 * ningun modulo de Node directamente (contextIsolation activo).
 */
contextBridge.exposeInMainWorld('streamAPI', {
  startStream: (config) => ipcRenderer.invoke('stream:start', config),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  togglePause: () => ipcRenderer.invoke('stream:toggle-pause'),
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
  getTrackAudio: (id) => ipcRenderer.invoke('library:get-audio', id),

  // Podcast Studio
  listEpisodes: () => ipcRenderer.invoke('podcast:list'),
  createEpisode: (input) => ipcRenderer.invoke('podcast:create', input),
  updateEpisode: (id, patch) => ipcRenderer.invoke('podcast:update', id, patch),
  deleteEpisode: (id) => ipcRenderer.invoke('podcast:delete', id),
  exportEpisode: (id) => ipcRenderer.invoke('podcast:export', id),
  cancelPodcastExport: () => ipcRenderer.invoke('podcast:export-cancel'),
  podcastExportStatus: () => ipcRenderer.invoke('podcast:export-status'),
  revealPodcastExport: (filePath) => ipcRenderer.invoke('podcast:reveal-export', filePath),
  startPodcastRecording: (deviceId) => ipcRenderer.invoke('podcast:record-start', deviceId),
  stopPodcastRecording: () => ipcRenderer.invoke('podcast:record-stop'),
  podcastRecordingStatus: () => ipcRenderer.invoke('podcast:record-status'),
  getPodcastWaveform: (segment) => ipcRenderer.invoke('podcast:waveform', segment),
  getPodcastSegmentAudio: (segment) => ipcRenderer.invoke('podcast:segment-audio', segment),
  measurePodcastEpisode: (episode) => ipcRenderer.invoke('podcast:metrics', episode),

  // Configuracion persistida (servidor, credenciales, pistas activas)
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  listProviders: () => ipcRenderer.invoke('providers:list'),

  // Actualizaciones (boton manual + popup/insignia en la barra lateral)
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  restartToUpdate: () => ipcRenderer.invoke('updates:restart'),

  // Historial de transmisiones
  listHistory: () => ipcRenderer.invoke('history:list'),
  revealRecording: (filePath) => ipcRenderer.invoke('history:reveal-recording', filePath),

  // Programacion automatica
  loadSchedule: () => ipcRenderer.invoke('schedule:load'),
  saveSchedule: (schedule) => ipcRenderer.invoke('schedule:save', schedule),

  // Modo mini-ventana flotante
  setCompactMode: (enabled) => ipcRenderer.invoke('window:set-compact', enabled),

  onLog: (callback) => subscribe('stream:log', callback),
  onStatus: (callback) => subscribe('stream:status', callback),
  onVuLevel: (callback) => subscribe('stream:vu-level', callback),
  onPreviewVuLevel: (callback) => subscribe('stream:preview-vu-level', callback),
  onSpectrum: (callback) => subscribe('stream:spectrum', callback),
  onDeadAir: (callback) => subscribe('stream:dead-air', callback),
  onIntroProgress: (callback) => subscribe('stream:intro-progress', callback),
  onOutroProgress: (callback) => subscribe('stream:outro-progress', callback),
  onUpdateState: (callback) => subscribe('app:update-state', callback),
  onPodcastExportProgress: (callback) => subscribe('podcast:export-progress', callback),
  onPodcastRecordingState: (callback) => subscribe('podcast:recording-state', callback),
  onPodcastRecordingLevel: (callback) => subscribe('podcast:recording-level', callback)
});

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
