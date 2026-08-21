const fs = require('fs');
const { spawn } = require('child_process');
const { resolveFfmpegPath } = require('./media-probe');
const libraryManager = require('./library-manager');

const TRACKS = ['voice', 'music', 'identity'];

function resolveSegmentPath(segment) {
  if (!segment?.sourceId) return null;
  if (segment.type === 'recording') return segment.sourceId;
  return libraryManager.getTrackPath(segment.sourceId);
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function runSegmentMeter(segment) {
  return new Promise((resolve) => {
    const filePath = resolveSegmentPath(segment);
    if (!filePath || !fs.existsSync(filePath)) {
      resolve(null);
      return;
    }
    const start = Math.max(0, numberOr(segment.trimStart, 0));
    const duration = Math.max(0.1, numberOr(segment.durationSeconds, 0.1));
    const end = numberOr(segment.trimEnd, duration);
    const volume = Math.max(0, numberOr(segment.volume, 1));
    const filter = `${end > start ? `atrim=start=${start}:end=${end}` : `atrim=start=${start}`},asetpts=PTS-STARTPTS,volume=${volume},astats=metadata=1:reset=0,ebur128=framelog=verbose`;
    let process;
    try {
      process = spawn(resolveFfmpegPath(), ['-hide_banner', '-nostats', '-i', filePath, '-af', filter, '-f', 'null', 'NUL'], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let stderr = '';
    process.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    process.on('error', () => resolve(null));
    process.on('close', () => {
      const rmsMatches = [...stderr.matchAll(/RMS level dB:\s*(-?[\d.]+)/gi)];
      const rmsMatch = rmsMatches.length ? rmsMatches[rmsMatches.length - 1] : null;
      const peakMatches = [...stderr.matchAll(/Peak level dB:\s*(-?[\d.]+)/gi)];
      const peakMatch = peakMatches.length ? peakMatches[peakMatches.length - 1] : null;
      const lufsMatches = [...stderr.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/gi)];
      const lufsMatch = lufsMatches.length ? lufsMatches[lufsMatches.length - 1] : null;
      resolve({
        rmsDb: rmsMatch ? Number(rmsMatch[1]) : -100,
        peakDb: peakMatch ? Number(peakMatch[1]) : -100,
        lufs: lufsMatch ? Number(lufsMatch[1]) : -100,
        durationSeconds: Math.max(0, (end > start ? end : duration) - start)
      });
    });
  });
}

async function measureEpisode(episode) {
  const result = {
    measuredAt: new Date().toISOString(),
    tracks: Object.fromEntries(TRACKS.map((track) => [track, { rmsDb: -100, peakDb: -100, lufs: -100, segments: 0 }]))
  };
  for (const segment of episode?.segments || []) {
    const track = TRACKS.includes(segment.track) ? segment.track : segment.type === 'recording' ? 'voice' : 'music';
    const metrics = await runSegmentMeter(segment);
    if (!metrics) continue;
    const target = result.tracks[track];
    const previousWeight = target._weight || 0;
    const weight = Math.max(0.01, metrics.durationSeconds);
    const toPower = (db) => Math.pow(10, db / 10);
    const fromPower = (power) => power > 0 ? 10 * Math.log10(power) : -100;
    target.rmsDb = fromPower((toPower(target.rmsDb) * previousWeight + toPower(metrics.rmsDb) * weight) / (previousWeight + weight));
    target.lufs = (target.lufs * previousWeight + metrics.lufs * weight) / (previousWeight + weight);
    target.peakDb = Math.max(target.peakDb, metrics.peakDb);
    target.segments += 1;
    target._weight = previousWeight + weight;
  }
  Object.values(result.tracks).forEach((track) => { delete track._weight; });
  return result;
}

module.exports = { measureEpisode };
