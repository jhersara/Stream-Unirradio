const assert = require('assert');
const net = require('net');
const { ShoutcastSourceBridge } = require('./src/main/shoutcast-source');

const server = net.createServer();
let received = Buffer.alloc(0);
let resolveReceived;
const receivedPromise = new Promise((resolve) => { resolveReceived = resolve; });

server.on('connection', (socket) => {
  let authenticated = false;
  socket.on('data', (chunk) => {
    received = Buffer.concat([received, chunk]);
    const text = received.toString('latin1');
    if (!authenticated && text.includes('radio-pass:7\r\n')) {
      authenticated = true;
      socket.write('OK2');
      return;
    }
    if (authenticated && text.includes('icy-name:Test Radio') && text.includes('\r\n\r\n')) {
      resolveReceived(received);
    }
  });
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const bridge = new ShoutcastSourceBridge({ server: '127.0.0.1', port: address.port, password: 'radio-pass', streamId: '7', stationName: 'Test Radio' });
  await bridge.connect();
  assert.strictEqual(bridge.state, 'ready');
  bridge.write(Buffer.from('MP3-FRAME'));
  const payload = await Promise.race([receivedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))]);
  const text = payload.toString('latin1');
  assert.ok(text.includes('radio-pass:7\r\n'));
  assert.ok(text.includes('icy-name:Test Radio'));
  assert.ok(text.includes('MP3-FRAME'));
  bridge.close();
  server.close();
  console.log('shoutcast-source: OK');
})().catch((error) => {
  server.close();
  console.error(error);
  process.exitCode = 1;
});
