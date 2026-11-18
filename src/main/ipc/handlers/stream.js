const { ipcMain } = require('electron');
const stream = require('../../services/stream');
const audioCapture = require('../../services/audio/capture');
const { sendLog } = require('../events');

/** Transmision, grabacion local, prueba de microfono y dispositivos. */
function registerStreamHandlers(getWindow) {
  ipcMain.handle('stream:start', (event, config) => stream.startStream(getWindow(), config));
  ipcMain.handle('stream:stop', () => stream.stopStream(getWindow()));
  ipcMain.handle('stream:toggle-pause', () => stream.togglePauseStream(getWindow()));
  ipcMain.handle('stream:set-gain', (event, value) => {
    stream.setGain(Number(value));
    return { ok: true };
  });

  ipcMain.handle('recording:choose-folder', () => stream.chooseRecordingFolder(getWindow()));
  ipcMain.handle('recording:save', (event, payload = {}) => stream.savePendingRecording(getWindow(), {
    folder: payload.folder,
    name: payload.name
  }));
  ipcMain.handle('recording:save-default', () => stream.savePendingRecording(getWindow(), { useDefault: true }));

  ipcMain.handle('stream:preview-start', (event, deviceId) => stream.startPreview(getWindow(), deviceId));
  ipcMain.handle('stream:preview-stop', () => stream.stopPreview());

  ipcMain.handle('devices:list', () => {
    if (!audioCapture.isAvailable()) {
      const err = audioCapture.getLoadError();
      sendLog(
        getWindow(),
        `Aviso: no se pudo cargar el modulo de audio (naudiodon)${err ? ': ' + err.message : ''}. Revisa la Fase 1.5 del README.`
      );
      return [];
    }
    return audioCapture.listInputDevices();
  });

  // El renderer avisa si la vista actual muestra vumetro/espectro; si no,
  // el main deja de calcularlos y enviarlos.
  ipcMain.on('ui:metrics-demand', (event, wanted) => stream.setRendererDemand(Boolean(wanted)));
}

module.exports = { registerStreamHandlers };
