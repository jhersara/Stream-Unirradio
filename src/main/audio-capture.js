/**
 * Captura de microfono con naudiodon (bindings de PortAudio), directamente
 * en el proceso principal (ver especificacion funcional #1 del README: el
 * audio NUNCA pasa por IPC hacia el renderer).
 *
 * El require de naudiodon esta envuelto en try/catch a proposito: es un
 * modulo nativo que requiere compilar con node-gyp (Windows SDK). Si aun no
 * esta compilado en esta maquina (ver Fase 1.5 del README), la app debe
 * seguir arrancando igual -- solo que sin poder listar dispositivos ni
 * transmitir hasta que se resuelva.
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
    const devices = naudiodon.getDevices();
    return devices
      .filter((d) => d.maxInputChannels > 0)
      .map((d) => ({ id: String(d.id), name: d.name }));
  } catch {
    return [];
  }
}

/**
 * Crea (sin arrancar) un stream de entrada de audio. El caller debe llamar
 * .start() para comenzar a recibir eventos 'data', y .quit(callback) para
 * detenerlo.
 */
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

module.exports = { isAvailable, getLoadError, listInputDevices, createInputStream };
