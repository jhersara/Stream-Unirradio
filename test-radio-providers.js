const assert = require('assert');
const providers = require('./src/main/radio-providers');

const base = {
  server: 'link.zeno.fm',
  port: '80',
  mount: '/unir-radio',
  user: 'source',
  password: 'secret',
  streamId: '1'
};

const zeno = providers.buildEncoderProfile({ ...base, provider: 'zeno-icecast' });
assert.strictEqual(zeno.provider.id, 'zeno-icecast');
assert.ok(zeno.url.startsWith('icecast://source:secret@link.zeno.fm:80/'));
assert.ok(zeno.args.includes('-legacy_icecast'));
assert.ok(zeno.args.includes('128k'));

const centovaIcecast = providers.buildEncoderProfile({ ...base, provider: 'centova-icecast', server: 'radio.example.com', port: '8000', mount: 'live.mp3' });
assert.strictEqual(centovaIcecast.provider.id, 'centova-icecast');
assert.ok(centovaIcecast.url.includes('@radio.example.com:8000/live.mp3'));
assert.ok(centovaIcecast.args.includes('-legacy_icecast'));

const shoutcast = providers.buildEncoderProfile({ ...base, provider: 'centova-shoutcast', server: 'radio.example.com', port: '8002', mount: '', streamId: '7' });
assert.strictEqual(shoutcast.provider.id, 'centova-shoutcast');
assert.strictEqual(shoutcast.outputMode, 'shoutcast-source');
assert.strictEqual(shoutcast.sourceHost, 'radio.example.com');
assert.strictEqual(shoutcast.sourcePort, 8002);
assert.strictEqual(shoutcast.streamId, '7');
assert.strictEqual(shoutcast.args[shoutcast.args.length - 1], 'pipe:1');

assert.strictEqual(providers.validateConfig({ ...base, provider: 'centova-icecast', mount: '' }).ok, false);
assert.strictEqual(providers.validateConfig({ ...base, provider: 'centova-shoutcast', mount: '', user: '', streamId: '7' }).ok, true);
assert.strictEqual(providers.validateConfig({ ...base, provider: 'centova-shoutcast', mount: '', streamId: 'abc' }).ok, false);

console.log('radio-providers: OK');
