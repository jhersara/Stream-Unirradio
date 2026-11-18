const scheduleStore = require('../../stores/schedule');
const settingsStore = require('../../stores/settings');
const stream = require('../stream');
const { sendLog } = require('../../ipc/events');

/**
 * Programacion automatica: cada POLL_INTERVAL_MS compara la hora actual con
 * el horario (en memoria, sin leer disco) y inicia/detiene la transmision con
 * la ultima configuracion guardada. El sondeo se auto-corrige ante cambios de
 * hora del sistema o suspension del equipo.
 */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const POLL_INTERVAL_MS = 20000;

let timer = null;
let lastTriggeredKey = null; // evita repetir la misma accion el mismo dia

function startScheduler(getWindow) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => checkSchedule(getWindow), POLL_INTERVAL_MS);
  timer.unref?.();
  checkSchedule(getWindow);
}

function checkSchedule(getWindow) {
  const schedule = scheduleStore.loadSchedule();
  if (!schedule.enabled) return;

  const now = new Date();
  if (!schedule.days.includes(DAY_KEYS[now.getDay()])) return;

  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayKey = now.toISOString().slice(0, 10);
  const mainWindow = getWindow();

  if (currentTime === schedule.startTime && lastTriggeredKey !== `start-${todayKey}` && !stream.isStreaming()) {
    lastTriggeredKey = `start-${todayKey}`;
    sendLog(mainWindow, `Programacion automatica: iniciando transmision (${schedule.startTime}).`);
    stream.startStream(mainWindow, {
      ...settingsStore.loadSettings(),
      recordSession: schedule.autoRecord,
      scheduled: true,
      recordingSavePrompt: false
    });
  }

  if (currentTime === schedule.stopTime && lastTriggeredKey !== `stop-${todayKey}` && stream.isStreaming()) {
    lastTriggeredKey = `stop-${todayKey}`;
    sendLog(mainWindow, `Programacion automatica: deteniendo transmision (${schedule.stopTime}).`);
    stream.stopStream(mainWindow, { promptRecording: false });
  }
}

module.exports = { startScheduler };
