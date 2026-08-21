const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { getDurationSeconds } = require('./media-probe');

/**
 * Biblioteca UNICA y persistente de pistas de audio. Al "importar", cada
 * archivo se COPIA dentro de la carpeta de datos de usuario de la app (no
 * se referencia la ruta original) para que siga disponible aunque el
 * usuario mueva o borre el archivo original despues. El indice de
 * metadatos vive en media-library/library.json.
 *
 * La biblioteca es una sola lista de pistas: no existe una categoria fija
 * de "intro" ni de "outro" a nivel de almacenamiento. Cualquier pista
 * puede usarse como intro, como outro, o como ambas, segun se elija en
 * cada transmision (ver seleccion en la vista Estudio/Configuracion).
 */

function getLibraryRoot() {
  return path.join(app.getPath('userData'), 'media-library');
}

function getIndexPath() {
  return path.join(getLibraryRoot(), 'library.json');
}

function ensureTracksDir() {
  const dirPath = path.join(getLibraryRoot(), 'tracks');
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Lee el indice. Si todavia tiene el formato antiguo separado en
 * intros/outros (versiones previas de la app), lo migra a una lista unica
 * SIN mover archivos de disco: cada pista migrada simplemente recuerda en
 * que subcarpeta ya vive (relDir: 'intros' | 'outros'). Los archivos
 * nuevos siempre se guardan en la subcarpeta unificada 'tracks'.
 */
function readIndex() {
  const idxPath = getIndexPath();
  if (!fs.existsSync(idxPath)) return { tracks: [] };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
  } catch {
    return { tracks: [] };
  }

  if (Array.isArray(parsed.tracks)) {
    return { tracks: parsed.tracks };
  }

  if (Array.isArray(parsed.intros) || Array.isArray(parsed.outros)) {
    const migrated = {
      tracks: [
        ...(parsed.intros || []).map((t) => ({ ...t, relDir: 'intros' })),
        ...(parsed.outros || []).map((t) => ({ ...t, relDir: 'outros' }))
      ]
    };
    writeIndex(migrated);
    return migrated;
  }

  return { tracks: [] };
}

function writeIndex(data) {
  fs.mkdirSync(getLibraryRoot(), { recursive: true });
  fs.writeFileSync(getIndexPath(), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Importa una o varias pistas a la vez (sourcePaths siempre es un array,
 * aunque contenga un solo elemento). El indice se lee y se escribe una
 * sola vez para todo el lote, no por archivo.
 */
async function importTracks(sourcePaths) {
  ensureTracksDir();
  const index = readIndex();

  for (const sourcePath of sourcePaths) {
    const id = crypto.randomUUID();
    const ext = path.extname(sourcePath) || '.mp3';
    const destFileName = `${id}${ext}`;
    const destPath = path.join(getLibraryRoot(), 'tracks', destFileName);

    fs.copyFileSync(sourcePath, destPath);
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

  writeIndex(index);
  return index;
}

function deleteTrack(id) {
  const index = readIndex();
  const track = index.tracks.find((t) => t.id === id);
  if (track) {
    const filePath = path.join(getLibraryRoot(), track.relDir || 'tracks', track.fileName);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Si el archivo ya no existe, igual limpiamos el indice.
    }
    index.tracks = index.tracks.filter((t) => t.id !== id);
    writeIndex(index);
  }
  return index;
}

function listTracks() {
  return readIndex();
}

function getTrackPath(id) {
  const index = readIndex();
  const track = index.tracks.find((t) => t.id === id);
  if (!track) return null;
  return path.join(getLibraryRoot(), track.relDir || 'tracks', track.fileName);
}

module.exports = { importTracks, deleteTrack, listTracks, getTrackPath };
