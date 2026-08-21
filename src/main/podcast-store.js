const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

/**
 * Persistencia local de Podcast Studio.
 * Los episodios guardan metadatos y referencias a pistas de la biblioteca o
 * a tomas de voz creadas dentro de app.getPath('userData').
 */
function getRoot() {
  return path.join(app.getPath('userData'), 'podcast-studio');
}

function getIndexPath() {
  return path.join(getRoot(), 'episodes.json');
}

function readEpisodes() {
  const indexPath = getIndexPath();
  if (!fs.existsSync(indexPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEpisodes(episodes) {
  fs.mkdirSync(getRoot(), { recursive: true });
  fs.writeFileSync(getIndexPath(), JSON.stringify(episodes, null, 2), 'utf-8');
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeAutomation(points, duration, baseVolume) {
  const midpoint = Math.max(0, duration / 2);
  const fallback = [
    { time: 0, gain: baseVolume },
    { time: midpoint, gain: baseVolume },
    { time: Math.max(0, duration), gain: baseVolume }
  ];
  if (!Array.isArray(points) || points.length === 0) return fallback;
  return points
    .slice(0, 24)
    .map((point) => ({
      time: clamp(point?.time, 0, Math.max(0, duration), 0),
      gain: clamp(point?.gain, 0, 2, baseVolume)
    }))
    .sort((a, b) => a.time - b.time);
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments)) return [];
  let cursor = 0;
  return segments
    .filter((segment) => segment && segment.sourceId)
    .slice(0, 100)
    .map((segment, index) => {
      const type = segment.type === 'recording' ? 'recording' : 'library';
      const durationSeconds = clamp(segment.durationSeconds, 0, 86400, 0);
      const trimStart = clamp(segment.trimStart, 0, 86400, 0);
      const trimEnd = Number.isFinite(Number(segment.trimEnd)) ? clamp(segment.trimEnd, 0, 86400, 0) : null;
      const clipDuration = Math.max(0, (trimEnd != null && trimEnd > trimStart ? trimEnd : durationSeconds) - trimStart);
      const volume = clamp(segment.volume, 0, 2, 1);
      const startTime = Number.isFinite(Number(segment.startTime)) ? clamp(segment.startTime, 0, 86400, cursor) : cursor;
      cursor = Math.max(cursor, startTime + clipDuration);
      return {
        id: segment.id || crypto.randomUUID(),
        type,
        track: ['voice', 'music', 'identity'].includes(segment.track) ? segment.track : type === 'recording' ? 'voice' : 'music',
        sourceId: String(segment.sourceId),
        name: String(segment.name || `Clip ${index + 1}`).slice(0, 240),
        durationSeconds,
        trimStart,
        trimEnd,
        startTime,
        volume,
        fadeIn: clamp(segment.fadeIn, 0, 30, 0),
        fadeOut: clamp(segment.fadeOut, 0, 30, 0),
        automation: normalizeAutomation(segment.automation, clipDuration, volume),
        order: index
      };
    });
}

function normalizeMixSettings(settings = {}) {
  const busGain = settings.busGain || {};
  return {
    duckingEnabled: settings.duckingEnabled !== false,
    duckAmount: clamp(settings.duckAmount, 0, 1, 0.35),
    duckThresholdDb: clamp(settings.duckThresholdDb, -60, 0, -32),
    duckAttackMs: clamp(settings.duckAttackMs, 1, 2000, 80),
    duckReleaseMs: clamp(settings.duckReleaseMs, 10, 5000, 420),
    busGain: {
      voice: clamp(busGain.voice, 0, 2, 1),
      music: clamp(busGain.music, 0, 2, 1),
      identity: clamp(busGain.identity, 0, 2, 1)
    }
  };
}

function normalizeEpisode(input = {}) {
  const timestamp = nowIso();
  return {
    id: input.id || crypto.randomUUID(),
    title: String(input.title || 'Nuevo episodio').trim().slice(0, 160) || 'Nuevo episodio',
    description: String(input.description || '').slice(0, 2000),
    status: input.status === 'exported' ? 'exported' : 'draft',
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
    exportedAt: input.exportedAt || null,
    mixSettings: normalizeMixSettings(input.mixSettings),
    segments: normalizeSegments(input.segments)
  };
}

function listEpisodes() {
  return readEpisodes().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function getEpisode(id) {
  return readEpisodes().find((episode) => episode.id === id) || null;
}

function createEpisode(input = {}) {
  const episodes = readEpisodes();
  const episode = normalizeEpisode(input);
  episodes.push(episode);
  writeEpisodes(episodes);
  return episode;
}

function updateEpisode(id, patch = {}) {
  const episodes = readEpisodes();
  const index = episodes.findIndex((episode) => episode.id === id);
  if (index === -1) return null;

  const current = episodes[index];
  const next = {
    ...current,
    ...(Object.prototype.hasOwnProperty.call(patch, 'title') ? { title: String(patch.title || '').trim().slice(0, 160) || 'Sin título' } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'description') ? { description: String(patch.description || '').slice(0, 2000) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'segments') ? { segments: normalizeSegments(patch.segments) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'status') ? { status: patch.status === 'exported' ? 'exported' : 'draft' } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'exportPath') ? { exportPath: patch.exportPath || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'exportedAt') ? { exportedAt: patch.exportedAt || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'mixSettings') ? { mixSettings: normalizeMixSettings(patch.mixSettings) } : {}),
    updatedAt: nowIso()
  };
  episodes[index] = next;
  writeEpisodes(episodes);
  return next;
}

function deleteEpisode(id) {
  const episodes = readEpisodes();
  const filtered = episodes.filter((episode) => episode.id !== id);
  writeEpisodes(filtered);
  return filtered.length !== episodes.length;
}

module.exports = {
  listEpisodes,
  getEpisode,
  createEpisode,
  updateEpisode,
  deleteEpisode
};
