const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;

// Colas acotadas: nunca mas de 2 s de audio pendiente por destino.
const MAX_PIPE_QUEUE_BYTES = BYTES_PER_SECOND * 2;
const MAX_OUTPUT_QUEUE_BYTES = BYTES_PER_SECOND * 2;

const OUTRO_CUTOFF_SECONDS = 2;
const CHUNK_MS = 50;

// 10 actualizaciones/s bastan para interpolar el vumetro en el renderer.
const VU_EMIT_INTERVAL_MS = 100;
// Sin interfaz visible solo se vigila el aire muerto, una vez por segundo.
const HIDDEN_CHECK_INTERVAL_MS = 1000;

const RECONNECT_DELAYS_MS = [3000, 6000, 12000, 24000, 30000];
const SILENCE_PEAK_THRESHOLD = 0.02; // ~ -34 dB
const DEAD_AIR_SECONDS = 15;

// Un outro mas largo no se pre-decodifica durante toda la sesion (RAM).
const MAX_PREDECODE_SECONDS = 120;

module.exports = {
  SAMPLE_RATE,
  CHANNELS,
  BYTES_PER_SAMPLE,
  BYTES_PER_SECOND,
  MAX_PIPE_QUEUE_BYTES,
  MAX_OUTPUT_QUEUE_BYTES,
  OUTRO_CUTOFF_SECONDS,
  CHUNK_MS,
  VU_EMIT_INTERVAL_MS,
  HIDDEN_CHECK_INTERVAL_MS,
  RECONNECT_DELAYS_MS,
  SILENCE_PEAK_THRESHOLD,
  DEAD_AIR_SECONDS,
  MAX_PREDECODE_SECONDS
};
