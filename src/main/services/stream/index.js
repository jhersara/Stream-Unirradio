/**
 * Fachada publica del servicio de transmision. El resto de la app solo
 * importa este modulo; los detalles viven en los archivos hermanos:
 *
 *   lifecycle.js        iniciar / pausar / detener / cerrar
 *   connection.js       encoder FFmpeg, fuente SHOUTcast y reconexion
 *   output.js           cola de salida hacia encoder y grabacion
 *   pipe-writer.js      escritura con contrapresion hacia stdin
 *   live-metrics.js     vumetro, espectro y aire muerto
 *   local-recording.js  grabacion local mp3 de la emision
 *   pcm-player.js       intro/outro decodificados y reproducidos a ritmo real
 *   preview.js          prueba de microfono
 */
const lifecycle = require('./lifecycle');
const preview = require('./preview');
const localRecording = require('./local-recording');
const uiVisibility = require('./ui-visibility');

module.exports = {
  startStream: lifecycle.startStream,
  stopStream: lifecycle.stopStream,
  togglePauseStream: lifecycle.togglePauseStream,
  setGain: lifecycle.setGain,
  shutdown: lifecycle.shutdown,
  isStreaming: lifecycle.isStreaming,
  chooseRecordingFolder: localRecording.chooseRecordingFolder,
  savePendingRecording: localRecording.savePendingRecording,
  startPreview: preview.startPreview,
  stopPreview: preview.stopPreview,
  isPreviewing: preview.isPreviewing,
  setWindowVisible: uiVisibility.setWindowVisible,
  setRendererDemand: uiVisibility.setRendererDemand
};
