const net = require('net');
const { EventEmitter } = require('events');

const HANDSHAKE_TIMEOUT_MS = 8000;

function cleanHost(server) {
  return String(server || '')
    .trim()
    .replace(/^\w+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '');
}

function buildIcyHeaders(config) {
  const bitrate = String(config.bitrate || '128k').replace(/k$/i, '');
  const stationName = String(config.stationName || 'UNIR Radio - Stream en vivo');
  const stationDescription = String(config.stationDescription || 'Transmision en vivo via Stream Radio');
  const stationGenre = String(config.stationGenre || 'Various');
  const stationUrl = String(config.stationUrl || 'https://unirradio.com');
  return [
    `icy-name:${stationName}`,
    `icy-description:${stationDescription}`,
    `icy-genre:${stationGenre}`,
    `icy-url:${stationUrl}`,
    'icy-pub:1',
    `icy-br:${bitrate}`,
    'icy-sr:44100',
    'icy-irc:N/A',
    'icy-icq:0',
    'icy-aim:N/A',
    '',
    ''
  ].join('\r\n');
}

/**
 * Cliente mínimo de fuente SHOUTcast sobre TCP/ICY.
 *
 * FFmpeg se encarga de codificar PCM a MP3 y este puente entrega los bytes
 * resultantes al servidor SHOUTcast. Para v2, el Stream ID se adjunta al
 * password con el formato compatible con los clientes source habituales:
 * password:streamId.
 */
class ShoutcastSourceBridge extends EventEmitter {
  constructor(config) {
    super();
    this.config = { ...config };
    this.socket = null;
    this.state = 'idle';
    this._handshakeTimer = null;
    this._settled = false;
  }

  connect() {
    if (this.state !== 'idle' && this.state !== 'closed') {
      return Promise.reject(new Error('El puente SHOUTcast ya está conectado o conectándose.'));
    }

    const host = cleanHost(this.config.server);
    const port = Number(this.config.port || 8000);
    const password = String(this.config.password || '');
    const streamId = String(this.config.streamId || '').trim();
    if (!host || !password) return Promise.reject(new Error('SHOUTcast necesita servidor y contraseña.'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(new Error('El puerto SHOUTcast no es válido.'));

    this.state = 'connecting';
    this._settled = false;
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      this.socket = socket;
      socket.setNoDelay(true);
      socket.setTimeout(HANDSHAKE_TIMEOUT_MS);

      const settleReject = (error) => {
        if (this._settled) return;
        this._settled = true;
        this._clearHandshakeTimer();
        this.state = 'error';
        try { socket.destroy(); } catch { /* noop */ }
        reject(error);
      };

      socket.once('connect', () => {
        this.state = 'authenticating';
        const sourcePassword = streamId ? `${password}:${streamId}` : password;
        // SHOUTcast ICY source protocol: authenticate with the password
        // (and, for v2, password:streamId), wait for OK2/OK, then send the
        // ICY metadata block before writing raw MPEG frames.
        socket.write(`${sourcePassword}\r\n`);
      });

      let response = '';
      socket.on('drain', () => this.emit('drain'));
      socket.on('data', (chunk) => {
        if (this.state !== 'authenticating') return;
        response += chunk.toString('latin1');
        const upper = response.toUpperCase();
        if (/\bOK2\b/.test(upper) || /(?:^|\r?\n)OK(?:\r?\n|$)/.test(upper)) {
          this._clearHandshakeTimer();
          this.state = 'ready';
          socket.setTimeout(0);
          socket.write(buildIcyHeaders(this.config));
          this._settled = true;
          this.emit('ready');
          resolve();
          return;
        }
        if (/INVALID|FAIL|ERROR|DENIED|REJECT/.test(upper)) {
          settleReject(new Error(`SHOUTcast rechazó la autenticación: ${response.trim().slice(0, 180)}`));
        }
      });

      socket.once('timeout', () => settleReject(new Error('Tiempo de espera agotado durante el handshake SHOUTcast.')));
      socket.once('error', (error) => {
        if (!this._settled) settleReject(error);
        else this.emit('error', error);
      });
      socket.once('close', () => {
        this._clearHandshakeTimer();
        const previous = this.state;
        this.socket = null;
        if (previous === 'ready') {
          this.state = 'closed';
          this.emit('close');
        } else if (!this._settled) {
          settleReject(new Error('El servidor SHOUTcast cerró la conexión durante el handshake.'));
        }
      });

      this._handshakeTimer = setTimeout(() => {
        settleReject(new Error('El servidor SHOUTcast no respondió al handshake.'));
      }, HANDSHAKE_TIMEOUT_MS);
    });
  }

  write(chunk) {
    if (this.state !== 'ready' || !this.socket || this.socket.destroyed) return false;
    return this.socket.write(chunk);
  }

  close() {
    this._clearHandshakeTimer();
    if (!this.socket) {
      this.state = 'closed';
      return;
    }
    try { this.socket.end(); } catch { /* noop */ }
    try { this.socket.destroy(); } catch { /* noop */ }
    this.socket = null;
    this.state = 'closed';
  }

  _clearHandshakeTimer() {
    if (this._handshakeTimer) {
      clearTimeout(this._handshakeTimer);
      this._handshakeTimer = null;
    }
  }
}

module.exports = { ShoutcastSourceBridge, buildIcyHeaders, cleanHost };
