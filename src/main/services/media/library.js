const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { getDurationSeconds } = require('./probe');
const { createJsonStore } = require('../../stores/json-store');

/**
 * Biblioteca unica y persistente de pistas. Importar COPIA el archivo dentro
 * de userData/media-library/tracks; el indice vive en library.json (cache en
 * memoria, escritura asincrona). Cualquier pista sirve como intro u outro.
 */
function getLibraryRoot() {
  return path.join(app.getPath('userData'), 'media-library');
}

const store = createJsonStore({
  filePath: () => path.join(getLibraryRoot(), 'library.json'),
  fallback: () => ({ tracks: [] }),
  migrate: (parsed) => {
    if (parsed && Array.isArray(parsed.tracks)) return { tracks: parsed.tracks };
    // Formato antiguo intros/outros: se unifica sin mover archivos de disco.
    if (parsed && (Array.isArray(parsed.intros) || Array.isArray(parsed.outros))) {
      return {
        tracks: [
          ...(parsed.intros || []).map((t) => ({ ...t, relDir: 'intros' })),
          ...(parsed.outros || []).map((t) => ({ ...t, relDir: 'outros' }))
        ]
      };
    }
    return { tracks: [] };
  }
});

function trackFilePath(track) {
  return path.join(getLibraryRoot(), track.relDir || 'tracks', track.fileName);
}

/** Importa varias pistas; el indice se escribe una sola vez por lote. */
async function importTracks(sourcePaths) {
  const tracksDir = path.join(getLibraryRoot(), 'tracks');
  await fs.promises.mkdir(tracksDir, { recursive: true });
  const index = store.get();

  for (const sourcePath of sourcePaths) {
    const id = crypto.randomUUID();
    const ext = path.extname(sourcePath) || '.mp3';
    const destFileName = `${id}${ext}`;
    const destPath = path.join(tracksDir, destFileName);

    await fs.promises.copyFile(sourcePath, destPath);
    const durationSeconds = await getDurationSeconds(destPath);

    index.tracks.push({
      id,
      name: path.basename(sourcePath, path.extname(sourcePath)),
      fileName: destFileName,
      relDir: 'tracks',
      durationSeconds: typeof durationSeconds === 'number' ? durationSeconds : null,
      importedAt: new Date().toISOString()
    });
  }

  store.set(index);
  return index;
}

async function deleteTrack(id) {
  const index = store.get();
  const track = index.tracks.find((t) => t.id === id);
  if (track) {
    // Si el archivo ya no existe, igual se limpia el indice.
    await fs.promises.unlink(trackFilePath(track)).catch(() => {});
    index.tracks = index.tracks.filter((t) => t.id !== id);
    store.set(index);
  }
  return index;
}

function listTracks() {
  return store.get();
}

function getTrack(id) {
  return store.get().tracks.find((t) => t.id === id) || null;
}

function getTrackPath(id) {
  const track = getTrack(id);
  return track ? trackFilePath(track) : null;
}

module.exports = { importTracks, deleteTrack, listTracks, getTrack, getTrackPath };
