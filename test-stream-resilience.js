const http = require('http');
const net = require('net');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function main() {
  let receivedBytes = 0;
  let headerComplete = false;
  const server = net.createServer((socket) => {
    let header = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (!headerComplete) {
        header = Buffer.concat([header, chunk]);
        const marker = header.indexOf('\r\n\r\n');
        if (marker >= 0) {
          headerComplete = true;
          socket.write('HTTP/1.0 200 OK\r\nContent-Type: audio/mpeg\r\n\r\n');
        }
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const targets = await getJson(`http://127.0.0.1:${process.env.CDP_PORT || '9222'}/json/list`);
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

  async function evaluate(expression, label) {
    console.log(`TEST_STAGE_START ${label}`);
    const result = await Promise.race([
      command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout en ${label}`)), 12000))
    ]);
    const value = result?.result?.value;
    console.log(`TEST_STAGE_DONE ${label} ${JSON.stringify(value)}`);
    return value;
  }

  const serverPort = server.address().port;
  const config = {
    provider: 'centova-icecast',
    server: '127.0.0.1',
    port: String(serverPort),
    mount: 'radio',
    user: 'source',
    password: 'test-password',
    deviceId: 0,
    introEnabled: false,
    outroEnabled: false,
    recordSession: process.env.RECORD_SESSION === 'true',
    recordingSavePrompt: true,
    gain: 1,
    bitrate: '128k',
    stationName: 'Stream Radio Local Test'
  };

  const start = await evaluate(`window.streamAPI.startStream(${JSON.stringify(config)})`, 'start-stream');
  await sleep(3500);
  const libraryStress = process.env.SKIP_LIBRARY === 'true'
    ? { ok: true, skipped: true }
    : await evaluate(`(async()=>{
    const tracks = (await window.streamAPI.listLibrary())?.tracks || [];
    const track = tracks.slice().sort((a,b)=>(Number(a.durationSeconds)||999999)-(Number(b.durationSeconds)||999999))[0];
    if (!track) return {ok:false,reason:'no-track'};
    const audio = new Audio(); audio.preload='metadata';
    for(let i=0;i<4;i+=1){
      const ref = await window.streamAPI.getTrackAudioUrl(track.id);
      if(!ref?.url) return {ok:false,reason:'no-url',attempt:i};
      const loaded = await new Promise(resolve=>{
        const timer=setTimeout(()=>resolve(false),3000);
        audio.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve(true)},{once:true});
        audio.addEventListener('error',()=>{clearTimeout(timer);resolve(false)},{once:true});
        audio.src=ref.url; audio.load();
      });
      audio.removeAttribute('src'); audio.load();
      if(!loaded) return {ok:false,reason:'media-error',attempt:i};
    }
    return {ok:true,id:track.id,duration:track.durationSeconds};
  })()`, 'library-stress');
  const stop = await evaluate('window.streamAPI.stopStream()', 'stop-stream');
  await sleep(Number(process.env.SAVE_WAIT_MS || 4000));
  const save = config.recordSession
    ? await evaluate('window.streamAPI.saveRecordingDefault()', 'save-recording')
    : { ok: true, skipped: true };
  await sleep(500);
  const responsive = await evaluate('({ok: true, title: document.title, readyState: document.readyState})', 'responsive-check');

  socket.close();
  server.close();
  console.log(JSON.stringify({ start, libraryStress, stop, save, responsive, headerComplete, receivedBytes }));
  if (!start?.ok || !libraryStress?.ok || !stop?.ok || !save?.ok || !responsive?.ok || !headerComplete || receivedBytes < 1000) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
