const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

/**
 * Historial de transmisiones pasadas: cada vez que una sesion termina (por
 * el usuario, por un error, o porque se cerro la app a mitad de una
 * transmision), se guarda una entrada aqui. Vive en history.json dentro de
 * la carpeta de datos de usuario, igual patron que library.json/settings.json.
 */

const MAX_ENTRIES = 200;

function getHistoryPath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function readHistory() {
  const historyPath = getHistoryPath();
  if (!fs.existsSync(historyPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  fs.writeFileSync(getHistoryPath(), JSON.stringify(list, null, 2), 'utf-8');
}

/** entry: { startedAt, endedAt, durationSeconds, server, mount, recordingPath, endReason } */
function addSession(entry) {
  const list = readHistory();
  list.unshift({ id: crypto.randomUUID(), ...entry });
  const trimmed = list.slice(0, MAX_ENTRIES);
  writeHistory(trimmed);
  return trimmed;
}

function listSessions() {
  return readHistory();
}

module.exports = { addSession, listSessions };
