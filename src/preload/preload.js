const { contextBridge, ipcRenderer } = require('electron');

/**
 * Superficie expuesta al renderer (window.streamAPI). El renderer nunca toca
 * ipcRenderer ni modulos de Node (contextIsolation activo y sandbox).
 *
 * invoke(canal) -> funcion que llama al main y devuelve una promesa
 * listen(canal) -> suscripcion a eventos del main; devuelve la funcion de baja
 */
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

function listen(channel, map = (payload) => payload) {
  return (callback) => {
    const listener = (_event, payload) => callback(map(payload));
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('streamAPI', {
  // Transmision
  startStream: invoke('stream:start'),
  stopStream: invoke('stream:stop'),
  togglePause: invoke('stream:toggle-pause'),
  setGain: invoke('stream:set-gain'),
  listDevices: invoke('devices:list'),
  getAppInfo: invoke('app:info'),

  // Grabacion local de la emision
  chooseRecordingFolder: invoke('recording:choose-folder'),
  saveRecording: invoke('recording:save'),
  saveRecordingDefault: invoke('recording:save-default'),

  // Prueba de microfono (fuera de una transmision real)
  startPreview: invoke('stream:preview-start'),
  stopPreview: invoke('stream:preview-stop'),

  // Biblioteca persistente de pistas
  listLibrary: invoke('library:list'),
  importTracks: invoke('library:import'),
  deleteTrack: invoke('library:delete'),
  getTrackAudioUrl: invoke('library:get-audio-url'),

  // Podcast Studio
  listEpisodes: invoke('podcast:list'),
  createEpisode: invoke('podcast:create'),
  updateEpisode: invoke('podcast:update'),
  deleteEpisode: invoke('podcast:delete'),
  exportEpisode: invoke('podcast:export'),
  cancelPodcastExport: invoke('podcast:export-cancel'),
  podcastExportStatus: invoke('podcast:export-status'),
  revealPodcastExport: invoke('podcast:reveal-export'),
  startPodcastRecording: invoke('podcast:record-start'),
  stopPodcastRecording: invoke('podcast:record-stop'),
  podcastRecordingStatus: invoke('podcast:record-status'),
  getPodcastWaveform: invoke('podcast:waveform'),
  getPodcastSegmentAudioUrl: invoke('podcast:segment-audio-url'),
  measurePodcastEpisode: invoke('podcast:metrics'),

  // Configuracion, proveedores, actualizaciones, historial y programacion
  loadSettings: invoke('settings:load'),
  saveSettings: invoke('settings:save'),
  listProviders: invoke('providers:list'),
  checkForUpdates: invoke('updates:check'),
  getUpdateState: invoke('updates:state'),
  restartToUpdate: invoke('updates:restart'),
  listHistory: invoke('history:list'),
  revealRecording: invoke('history:reveal-recording'),
  loadSchedule: invoke('schedule:load'),
  saveSchedule: invoke('schedule:save'),

  // Ventana
  setCompactMode: invoke('window:set-compact'),
  // El renderer informa si muestra vumetro/espectro (el main deja de calcularlos si no).
  setMetricsDemand: (wanted) => ipcRenderer.send('ui:metrics-demand', Boolean(wanted)),

  // Eventos main -> renderer
  onLog: listen('stream:log'),
  onStatus: listen('stream:status'),
  onAudioMetrics: listen('stream:audio-metrics'),
  onVuLevel: listen('stream:audio-metrics', (payload) => payload.vu),
  onSpectrum: listen('stream:audio-metrics', (payload) => ({ bands: payload.bands })),
  onPreviewVuLevel: listen('stream:preview-vu-level'),
  onDeadAir: listen('stream:dead-air'),
  onIntroProgress: listen('stream:intro-progress'),
  onOutroProgress: listen('stream:outro-progress'),
  onUpdateState: listen('app:update-state'),
  onPodcastExportProgress: listen('podcast:export-progress'),
  onPodcastRecordingState: listen('podcast:recording-state'),
  onPodcastRecordingLevel: listen('podcast:recording-level'),
  onRecordingSaveState: listen('recording:save-state')
});
