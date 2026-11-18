const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { createJsonStore } = require('./json-store');

/**
 * Persistencia local de Podcast Studio. Los episodios guardan metadatos y
 * referencias a pistas de la biblioteca o a tomas de voz dentro de userData.
 */
function getRoot() {
  return path.join(app.getPath('userData'), 'podcast-studio');
}

function getRecordingsRoot() {
  return path.join(getRoot(), 'recordings');
}

const store = createJsonStore({
  filePath: () => path.join(getRoot(), 'episodes.json'),
  fallback: () => [],
  migrate: (data) => (Array.isArray(data) ? data : [])
});

const nowIso = () => new Date().toISOString();
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

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
  return [...store.get()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function getEpisode(id) {
  return store.get().find((episode) => episode.id === id) || null;
}

function createEpisode(input = {}) {
  const episode = normalizeEpisode(input);
  store.set([...store.get(), episode]);
  return episode;
}

function updateEpisode(id, patch = {}) {
  const episodes = [...store.get()];
  const index = episodes.findIndex((episode) => episode.id === id);
  if (index === -1) return null;

  const current = episodes[index];
  const next = {
    ...current,
    ...(has(patch, 'title') ? { title: String(patch.title || '').trim().slice(0, 160) || 'Sin título' } : {}),
    ...(has(patch, 'description') ? { description: String(patch.description || '').slice(0, 2000) } : {}),
    ...(has(patch, 'segments') ? { segments: normalizeSegments(patch.segments) } : {}),
    ...(has(patch, 'status') ? { status: patch.status === 'exported' ? 'exported' : 'draft' } : {}),
    ...(has(patch, 'exportPath') ? { exportPath: patch.exportPath || null } : {}),
    ...(has(patch, 'exportedAt') ? { exportedAt: patch.exportedAt || null } : {}),
    ...(has(patch, 'mixSettings') ? { mixSettings: normalizeMixSettings(patch.mixSettings) } : {}),
    updatedAt: nowIso()
  };
  episodes[index] = next;
  store.set(episodes);
  return next;
}

function deleteEpisode(id) {
  const episodes = store.get();
  const filtered = episodes.filter((episode) => episode.id !== id);
  store.set(filtered);
  return filtered.length !== episodes.length;
}

module.exports = {
  getRecordingsRoot,
  listEpisodes,
  getEpisode,
  createEpisode,
  updateEpisode,
  deleteEpisode
};
