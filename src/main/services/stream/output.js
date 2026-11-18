const state = require('./state');
const { MAX_OUTPUT_QUEUE_BYTES } = require('./constants');
const { sendLog } = require('../../ipc/events');

/**
 * Cola de salida: el audio capturado/reproducido se encola y se bombea a los
 * destinos (encoder y grabacion local) fuera del callback de captura, en
 * trozos de 5 ms maximo, para no bloquear el event loop.
 */
function pumpOutputQueue(current) {
  if (!current || state.session !== current) return;
  current.outputPumpScheduled = false;
  const startedAt = Date.now();
  while (current.outputQueue.length > 0 && Date.now() - startedAt < 5) {
    const chunk = current.outputQueue.shift();
    current.outputQueueBytes -= chunk.length;
    current.encoderWriter.write(chunk);
    current.recorderWriter.write(chunk);
  }
  if (current.outputQueue.length > 0 && state.session === current) {
    current.outputPumpScheduled = true;
    setImmediate(() => pumpOutputQueue(current));
  }
}

/**
 * Encola audio para los destinos. El buffer NO se copia aqui: quien llama
 * debe pasar un buffer propio (copyChunk) o de solo lectura (silencio, PCM
 * decodificado de intro/outro).
 */
function writeToOutputs(chunk) {
  const current = state.session;
  if (!current || !chunk || !chunk.length) return;

  if (current.outputQueueBytes + chunk.length <= MAX_OUTPUT_QUEUE_BYTES) {
    current.outputQueue.push(chunk);
    current.outputQueueBytes += chunk.length;
  } else if (!current.outputQueueWarned) {
    current.outputQueueWarned = true;
    sendLog(current.mainWindow, 'Aviso: la salida de audio está saturada; se limita la cola para proteger la memoria y mantener viva la interfaz.');
  }
  if (!current.outputPumpScheduled) {
    current.outputPumpScheduled = true;
    setImmediate(() => pumpOutputQueue(current));
  }
}

module.exports = { writeToOutputs };
