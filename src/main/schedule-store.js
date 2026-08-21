const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Persiste la configuracion de programacion automatica (horario de
 * inicio/fin, dias de la semana, si graba automaticamente). Mismo patron
 * que settings-store.js / history-store.js.
 */

const DEFAULT_SCHEDULE = {
  enabled: false,
  startTime: '07:00',
  stopTime: '09:00',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  autoRecord: false
};

function getSchedulePath() {
  return path.join(app.getPath('userData'), 'schedule.json');
}

function loadSchedule() {
  const schedulePath = getSchedulePath();
  if (!fs.existsSync(schedulePath)) return { ...DEFAULT_SCHEDULE };
  try {
    const saved = JSON.parse(fs.readFileSync(schedulePath, 'utf-8'));
    return { ...DEFAULT_SCHEDULE, ...saved };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

function saveSchedule(schedule) {
  const toSave = { ...DEFAULT_SCHEDULE, ...schedule };
  fs.writeFileSync(getSchedulePath(), JSON.stringify(toSave, null, 2), 'utf-8');
  return toSave;
}

module.exports = { loadSchedule, saveSchedule, DEFAULT_SCHEDULE };
