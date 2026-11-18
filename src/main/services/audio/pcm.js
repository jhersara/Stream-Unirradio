'use strict';

/** Vista Int16Array sobre un Buffer PCM s16le (copia solo si esta desalineado). */
function asInt16(buffer) {
  const length = buffer.length >> 1;
  if (buffer.byteOffset % 2 === 0) {
    return new Int16Array(buffer.buffer, buffer.byteOffset, length);
  }
  const copy = new Uint8Array(length * 2);
  copy.set(buffer.subarray(0, length * 2));
  return new Int16Array(copy.buffer, 0, length);
}

/**
 * Copia unica de un bloque de captura. naudiodon puede reutilizar su buffer
 * despues del callback, asi que el audio que se encola debe ser propio.
 * allocUnsafeSlow evita el pool compartido y garantiza alineacion a 2 bytes.
 */
function copyChunk(chunk) {
  const owned = Buffer.allocUnsafeSlow(chunk.length);
  chunk.copy(owned);
  return owned;
}

/** Aplica ganancia en sitio (con saturacion) sobre un buffer propio. */
function applyGainInPlace(buffer, gain) {
  if (!gain || gain === 1) return buffer;

  if (buffer.byteOffset % 2 !== 0) {
    for (let i = 0; i + 1 < buffer.length; i += 2) {
      const value = Math.max(-32768, Math.min(32767, Math.round(buffer.readInt16LE(i) * gain)));
      buffer.writeInt16LE(value, i);
    }
    return buffer;
  }

  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length >> 1);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.round(samples[i] * gain);
    samples[i] = value > 32767 ? 32767 : value < -32768 ? -32768 : value;
  }
  return buffer;
}

let silence = Buffer.alloc(16384);

/** Silencio PCM de solo lectura (se comparte entre llamadas; nadie lo muta). */
function getSilence(length) {
  if (length > silence.length) silence = Buffer.alloc(length);
  return silence.subarray(0, length);
}

module.exports = { asInt16, copyChunk, applyGainInPlace, getSilence };
