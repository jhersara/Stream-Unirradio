const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { createJsonStore } = require('./json-store');

/**
 * Historial de transmisiones (history.json). Cada sesion que termina, por el
 * usuario, por error o por cierre de la app, agrega una entrada.
 */
const MAX_ENTRIES = 200;

const store = createJsonStore({
  filePath: () => path.join(app.getPath('userData'), 'history.json'),
  fallback: () => [],
  migrate: (data) => (Array.isArray(data) ? data : [])
});

/** entry: { startedAt, endedAt, durationSeconds, server, mount, recordingPath, endReason } */
function addSession(entry) {
  const list = [{ id: crypto.randomUUID(), ...entry }, ...store.get()].slice(0, MAX_ENTRIES);
  store.set(list);
  return list;
}

function listSessions() {
  return store.get();
}

module.exports = { addSession, listSessions };
