const path = require('path');
const { app } = require('electron');
const { createJsonStore } = require('./json-store');

/**
 * Programacion automatica (schedule.json). Se mantiene en memoria: el
 * scheduler la consulta cada 20 s sin tocar el disco.
 */
const DEFAULT_SCHEDULE = {
  enabled: false,
  startTime: '07:00',
  stopTime: '09:00',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  autoRecord: false
};

const store = createJsonStore({
  filePath: () => path.join(app.getPath('userData'), 'schedule.json'),
  fallback: () => ({})
});

function loadSchedule() {
  return { ...DEFAULT_SCHEDULE, ...store.get() };
}

function saveSchedule(schedule) {
  const toSave = { ...DEFAULT_SCHEDULE, ...schedule };
  store.set(toSave);
  return toSave;
}

module.exports = { loadSchedule, saveSchedule, DEFAULT_SCHEDULE };
