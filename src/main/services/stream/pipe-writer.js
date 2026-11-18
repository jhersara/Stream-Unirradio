/**
 * Escritor hacia el stdin de un proceso con cola acotada y control de
 * contrapresion. Sustituye las dos implementaciones duplicadas (encoder y
 * grabacion local) que habia antes.
 */
class PipeWriter {
  constructor({ maxBytes, onOverflow = null, onBackpressure = null }) {
    this.maxBytes = maxBytes;
    this.onOverflow = onOverflow;
    this.onBackpressure = onBackpressure;
    this.stdin = null;
    this.queue = [];
    this.bytes = 0;
    this.backpressured = false;
    this.drainAttached = false;
    this.overflowWarned = false;
    this.backpressureWarned = false;
    this.generation = 0;
  }

  /** Conecta un nuevo stdin (inicio o reconexion) y descarta el estado anterior. */
  attach(stdin) {
    this.generation += 1;
    this.stdin = stdin || null;
    this.queue.length = 0;
    this.bytes = 0;
    this.backpressured = false;
    this.drainAttached = false;
    // Un EPIPE asincrono no debe tumbar el proceso principal.
    if (stdin) stdin.on('error', () => {});
  }

  detach() {
    this.attach(null);
  }

  write(chunk) {
    const stdin = this.stdin;
    if (!stdin || stdin.destroyed || !chunk || !chunk.length) return;

    if (this.backpressured || this.queue.length > 0) {
      if (this.bytes + chunk.length <= this.maxBytes) {
        this.queue.push(chunk);
        this.bytes += chunk.length;
      } else if (!this.overflowWarned) {
        this.overflowWarned = true;
        this.onOverflow?.();
      }
      return;
    }

    try {
      if (!stdin.write(chunk)) this._waitForDrain(stdin);
    } catch {
      // Pipe roto: el evento 'close'/'error' del proceso se encarga.
    }
  }

  flush() {
    const stdin = this.stdin;
    if (!stdin || stdin.destroyed) return;
    while (this.queue.length > 0 && !stdin.destroyed) {
      const next = this.queue.shift();
      this.bytes -= next.length;
      try {
        if (!stdin.write(next)) {
          this._waitForDrain(stdin);
          return;
        }
      } catch {
        this.queue.length = 0;
        this.bytes = 0;
        return;
      }
    }
    this.backpressured = false;
  }

  _waitForDrain(stdin) {
    this.backpressured = true;
    if (!this.backpressureWarned) {
      this.backpressureWarned = true;
      this.onBackpressure?.();
    }
    if (this.drainAttached) return;
    this.drainAttached = true;
    const generation = this.generation;
    stdin.once('drain', () => {
      if (generation !== this.generation) return;
      this.drainAttached = false;
      this.backpressured = false;
      this.flush();
    });
  }
}

module.exports = { PipeWriter };
