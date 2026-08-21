const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { resolveFfmpegPath } = require('./media-probe');
const libraryManager = require('./library-manager');
const { sendLog, sendPodcastExportProgress } = require('./ipc-events');

const SAMPLE_RATE = 44100;
const FILTER_THREADS = Math.max(1, Math.min(4, (os.cpus()?.length || 2) - 1));
let activeExport = null;

function resolveSegmentPath(segment) {
  if (!segment || !segment.sourceId) return null;
  if (segment.type === 'recording') {
    return path.isAbsolute(segment.sourceId) ? segment.sourceId : null;
  }
  return libraryManager.getTrackPath(segment.sourceId);
}

function validNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function buildAutomationExpression(points, duration, fallbackGain) {
  const safePoints = Array.isArray(points) && points.length > 0
    ? points.map((point) => ({
      time: Math.min(duration, Math.max(0, validNumber(point.time))),
      gain: Math.min(2, Math.max(0, validNumber(point.gain, fallbackGain)))
    })).sort((a, b) => a.time - b.time)
    : [{ time: 0, gain: fallbackGain }, { time: duration, gain: fallbackGain }];
  let expression = String(safePoints[safePoints.length - 1].gain);
  for (let index = safePoints.length - 1; index > 0; index -= 1) {
    const previous = safePoints[index - 1];
    const current = safePoints[index];
    const span = Math.max(0.001, current.time - previous.time);
    const interpolation = `${previous.gain}+(${current.gain}-${previous.gain})*(t-${previous.time})/${span}`;
    expression = `if(lt(t\\,${current.time})\\,${interpolation}\\,${expression})`;
  }
  return `if(lt(t\\,${safePoints[0].time})\\,${safePoints[0].gain}\\,${expression})`;
}

function buildFilter(segments, mixSettings = {}) {
  const chains = [];
  const trackLabels = { voice: [], music: [], identity: [] };
  let cursor = 0;
  segments.forEach((segment, index) => {
    const start = Math.max(0, validNumber(segment.trimStart));
    const sourceDuration = Math.max(0, validNumber(segment.durationSeconds));
    const end = validNumber(segment.trimEnd, sourceDuration);
    const clipDuration = Math.max(0.01, (end > start ? end : sourceDuration) - start);
    const startTime = Number.isFinite(Number(segment.startTime)) ? Math.max(0, Number(segment.startTime)) : cursor;
    cursor = Math.max(cursor, startTime + clipDuration);
    const fadeIn = Math.min(clipDuration, Math.max(0, validNumber(segment.fadeIn)));
    const fadeOut = Math.min(clipDuration, Math.max(0, validNumber(segment.fadeOut)));
    const baseVolume = Math.min(2, Math.max(0, validNumber(segment.volume, 1)));
    const filters = [
      end > start ? `atrim=start=${start}:end=${end}` : `atrim=start=${start}`,
      'asetpts=PTS-STARTPTS',
      `volume=${buildAutomationExpression(segment.automation, clipDuration, baseVolume)}:eval=frame`
    ];
    if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
    if (fadeOut > 0) filters.push(`afade=t=out:st=${Math.max(0, clipDuration - fadeOut)}:d=${fadeOut}`);
    if (startTime > 0) filters.push(`adelay=${Math.round(startTime * 1000)}|${Math.round(startTime * 1000)}`);
    const label = `seg${index}`;
    chains.push(`[${index}:a]${filters.join(',')}[${label}]`);
    const track = ['voice', 'music', 'identity'].includes(segment.track) ? segment.track : 'music';
    trackLabels[track].push(`[${label}]`);
  });

  const busGain = mixSettings.busGain || {};
  const builtBuses = {};
  Object.entries(trackLabels).forEach(([track, labels]) => {
    if (labels.length === 0) return;
    const bus = `${track}bus`;
    const gain = Math.min(2, Math.max(0, validNumber(busGain[track], 1)));
    const source = labels.length === 1
      ? `${labels[0]}anull`
      : `${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0`;
    chains.push(`${source},volume=${gain}[${bus}]`);
    builtBuses[track] = bus;
  });

  let voiceOutput = builtBuses.voice ? `[${builtBuses.voice}]` : null;
  let musicOutput = builtBuses.music ? `[${builtBuses.music}]` : null;
  if (mixSettings.duckingEnabled !== false && voiceOutput && musicOutput) {
    const duckAmount = Math.min(1, Math.max(0, validNumber(mixSettings.duckAmount, 0.35)));
    const thresholdDb = Math.min(0, Math.max(-60, validNumber(mixSettings.duckThresholdDb, -32)));
    const threshold = Math.pow(10, thresholdDb / 20);
    const ratio = 1 + duckAmount * 19;
    const attack = Math.min(2000, Math.max(1, validNumber(mixSettings.duckAttackMs, 80)));
    const release = Math.min(5000, Math.max(10, validNumber(mixSettings.duckReleaseMs, 420)));
    chains.push(`${voiceOutput}asplit=2[voicekey][voiceout]`);
    chains.push(`${musicOutput}[voicekey]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[duckedmusic]`);
    voiceOutput = '[voiceout]';
    musicOutput = '[duckedmusic]';
  }

  const busLabels = [];
  if (voiceOutput) busLabels.push(voiceOutput);
  if (musicOutput) busLabels.push(musicOutput);
  if (builtBuses.identity) busLabels.push(`[${builtBuses.identity}]`);
  if (busLabels.length === 1) chains.push(`${busLabels[0]}anull[outa]`);
  else chains.push(`${busLabels.join('')}amix=inputs=${busLabels.length}:duration=longest:dropout_transition=0:normalize=0[outa]`);
  return chains.join(';');
}

function buildArgs(segments, outputPath, metadata) {
  const args = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-stats_period', '0.5', '-progress', 'pipe:2', '-threads', '0', '-filter_threads', String(FILTER_THREADS), '-filter_complex_threads', String(FILTER_THREADS)];
  segments.forEach((segment) => {
    args.push('-i', resolveSegmentPath(segment));
  });
  args.push(
    '-filter_complex', buildFilter(segments, metadata.mixSettings),
    '-map', '[outa]',
    '-ar', String(SAMPLE_RATE),
    '-ac', '2',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-max_muxing_queue_size', '1024',
    '-id3v2_version', '3',
    '-metadata', `title=${metadata.title}`,
    '-metadata', `comment=${metadata.description || 'Podcast creado con Stream Radio'}`,
    outputPath
  );
  return args;
}

function exportEpisode(mainWindow, episode, outputPath) {
  return new Promise((resolve, reject) => {
    const segments = Array.isArray(episode.segments) ? episode.segments : [];
    if (segments.length === 0) {
      reject(new Error('Añade al menos un clip a la línea de tiempo antes de exportar.'));
      return;
    }

    const resolvedPaths = segments.map(resolveSegmentPath);
    if (resolvedPaths.some((filePath) => !filePath || !fs.existsSync(filePath))) {
      reject(new Error('Uno de los clips ya no está disponible en la biblioteca.'));
      return;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    let cursor = 0;
    const totalSeconds = segments.reduce((maxEnd, segment) => {
      const sourceDuration = Math.max(0, validNumber(segment.durationSeconds));
      const trimStart = Math.max(0, validNumber(segment.trimStart));
      const trimEnd = validNumber(segment.trimEnd, sourceDuration);
      const clipDuration = Math.max(0, (trimEnd > trimStart ? trimEnd : sourceDuration) - trimStart);
      const startTime = Number.isFinite(Number(segment.startTime)) ? Math.max(0, Number(segment.startTime)) : cursor;
      cursor = Math.max(cursor, startTime + clipDuration);
      return Math.max(maxEnd, startTime + clipDuration);
    }, 0);

    if (activeExport) {
      const error = new Error('Ya hay una exportación en curso. Cancélala antes de iniciar otra.');
      error.code = 'EXPORT_BUSY';
      reject(error);
      return;
    }

    let process;
    const job = { process: null, outputPath, totalSeconds, cancelled: false, settled: false };
    try {
      process = spawn(resolveFfmpegPath(), buildArgs(segments, outputPath, episode), { windowsHide: true });
      job.process = process;
      activeExport = job;
    } catch (error) {
      reject(error);
      return;
    }

    sendPodcastExportProgress(mainWindow, { state: 'starting', percent: 0, totalSeconds });
    let stderrBuffer = '';
    let lastProgressAt = 0;
    let lastProgressPercent = -1;
    process.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || '';
      lines.forEach((line) => {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (!match) return;
        const elapsedSeconds = Number(match[1]) / 1000000;
        const percent = totalSeconds > 0 ? Math.min(100, (elapsedSeconds / totalSeconds) * 100) : 0;
        const now = Date.now();
        if (percent >= 99.9 || now - lastProgressAt >= 250 || percent - lastProgressPercent >= 1) {
          lastProgressAt = now;
          lastProgressPercent = percent;
          sendPodcastExportProgress(mainWindow, { state: 'exporting', percent, elapsedSeconds, totalSeconds });
        }
      });
    });

    const clearJob = () => {
      if (activeExport === job) activeExport = null;
    };
    process.on('error', (error) => {
      if (job.settled) return;
      job.settled = true;
      clearJob();
      sendPodcastExportProgress(mainWindow, { state: 'error', message: error.message });
      reject(error);
    });
    process.on('close', (code) => {
      if (job.settled) return;
      job.settled = true;
      clearJob();
      if (job.cancelled) {
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        const error = new Error('Exportación cancelada.');
        error.code = 'EXPORT_CANCELLED';
        sendPodcastExportProgress(mainWindow, { state: 'cancelled', percent: 0, totalSeconds, message: error.message });
        reject(error);
        return;
      }
      if (code === 0) {
        sendPodcastExportProgress(mainWindow, { state: 'completed', percent: 100, totalSeconds, outputPath });
        resolve({ ok: true, outputPath, totalSeconds });
      } else {
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        const error = new Error(`FFmpeg no pudo exportar el episodio (código ${code}).`);
        sendPodcastExportProgress(mainWindow, { state: 'error', message: error.message });
        reject(error);
      }
    });
  });
}

function cancelExport() {
  if (!activeExport || !activeExport.process) return { ok: false, reason: 'idle' };
  activeExport.cancelled = true;
  try { activeExport.process.kill(); } catch {}
  return { ok: true };
}

function isExporting() {
  return Boolean(activeExport && !activeExport.settled);
}

module.exports = { exportEpisode, cancelExport, isExporting };
