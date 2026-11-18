/**
 * Captura de microfono con naudiodon (PortAudio), directamente en el proceso
 * principal: el audio nunca pasa por IPC hacia el renderer.
 *
 * El require esta envuelto en try/catch: es un modulo nativo (node-gyp). Si
 * no esta compilado, la app arranca igual pero sin captura de audio.
 */
let naudiodon = null;
let loadError = null;
try {
  naudiodon = require('naudiodon');
} catch (err) {
  loadError = err;
}

function isAvailable() {
  return naudiodon !== null;
}

function getLoadError() {
  return loadError;
}

function listInputDevices() {
  if (!naudiodon) return [];
  try {
    return naudiodon.getDevices()
      .filter((d) => d.maxInputChannels > 0)
      .map((d) => ({ id: String(d.id), name: d.name }));
  } catch {
    return [];
  }
}

/** Crea (sin arrancar) un stream de entrada. El caller llama .start() y .quit(cb). */
function createInputStream(deviceId, sampleRate, channels) {
  if (!naudiodon) {
    throw new Error('naudiodon no esta disponible/compilado en este entorno.');
  }
  const parsedDeviceId = deviceId != null && deviceId !== '' ? Number(deviceId) : -1;
  return new naudiodon.AudioIO({
    inOptions: {
      channelCount: channels,
      sampleFormat: naudiodon.SampleFormat16Bit,
      sampleRate,
      deviceId: parsedDeviceId,
      closeOnError: true
    }
  });
}

/** Libera el dispositivo fuera del turno actual del event loop. */
function releaseInputStream(inputStream) {
  if (!inputStream) return;
  setImmediate(() => {
    try { inputStream.quit(() => {}); } catch { /* noop */ }
  });
}

module.exports = { isAvailable, getLoadError, listInputDevices, createInputStream, releaseInputStream };
