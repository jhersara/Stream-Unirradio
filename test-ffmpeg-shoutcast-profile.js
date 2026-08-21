const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const providers = require('./src/main/radio-providers');

const ffmpegPath = path.join(__dirname, 'resources', 'ffmpeg', 'ffmpeg.exe');
assert.ok(fs.existsSync(ffmpegPath), `No existe ${ffmpegPath}`);
const profile = providers.buildEncoderProfile({ provider: 'centova-shoutcast', server: '127.0.0.1', port: '8000', password: 'test', streamId: '1' });
const sampleRate = 44100;
const seconds = 0.35;
const samples = Math.floor(sampleRate * seconds);
const pcm = Buffer.alloc(samples * 2 * 2);
for (let i = 0; i < samples; i++) {
  const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 1000);
  pcm.writeInt16LE(value, i * 4);
  pcm.writeInt16LE(value, i * 4 + 2);
}

const proc = spawn(ffmpegPath, profile.args, { windowsHide: true });
const chunks = [];
let stderr = '';
proc.stdout.on('data', (chunk) => chunks.push(chunk));
proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
proc.on('error', (error) => { throw error; });
proc.stdin.end(pcm);
proc.on('close', (code) => {
  try {
    assert.strictEqual(code, 0, stderr);
    const mp3 = Buffer.concat(chunks);
    assert.ok(mp3.length > 1000, `MP3 demasiado pequeño: ${mp3.length}`);
    assert.ok(mp3.subarray(0, 3).toString('ascii') === 'ID3' || mp3.includes(Buffer.from([0xff, 0xfb])), 'No se detectó cabecera MP3');
    console.log(`ffmpeg-shoutcast-profile: OK (${mp3.length} bytes)`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
