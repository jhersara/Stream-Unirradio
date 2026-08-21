const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const port = process.env.CDP_PORT || '9222';
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!target) throw new Error('No se encontró la ventana de Electron en CDP.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    const resolver = pending.get(payload.id);
    if (!resolver) return;
    pending.delete(payload.id);
    if (payload.error) resolver.reject(new Error(payload.error.message));
    else resolver.resolve(payload.result);
  });

  function command(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  const expression = `
    (async () => {
      const button = document.querySelector('#track-list [data-preview-id]');
      if (!button) return { ok: false, reason: 'no-track-in-library' };
      const id = button.getAttribute('data-preview-id');
      const response = await window.streamAPI.getTrackAudioUrl(id);
      if (!response || !response.url) return { ok: false, reason: 'no-local-url' };
      const audio = new Audio();
      audio.preload = 'metadata';
      const metadata = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ event: 'timeout', readyState: audio.readyState }), 5000);
        audio.addEventListener('loadedmetadata', () => {
          clearTimeout(timeout);
          resolve({ event: 'loadedmetadata', readyState: audio.readyState, duration: audio.duration });
        }, { once: true });
        audio.addEventListener('error', () => {
          clearTimeout(timeout);
          resolve({ event: 'error', readyState: audio.readyState });
        }, { once: true });
        audio.src = response.url;
        audio.load();
      });
      // CDP no representa un gesto real del usuario; por eso este smoke test
      // valida el contrato de carga de medios y deja la reproducción audible a
      // la ruta real de click de la interfaz.
      audio.removeAttribute('src');
      audio.load();
      return { ok: metadata.event === 'loadedmetadata', id, url: response.url, metadata };
    })()
  `;

  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  console.log(JSON.stringify(result?.result?.value || { ok: false, reason: 'no-cdp-result' }));
  socket.close();
  await sleep(50);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
