const scheduleStore = require('./schedule-store');
const settingsStore = require('./settings-store');
const ffmpegStream = require('./ffmpeg-stream');
const { sendLog } = require('./ipc-events');

/**
 * Programacion automatica: revisa cada POLL_INTERVAL_MS (no con un
 * setTimeout de precision exacta) si la hora actual coincide con el
 * horario configurado, y si corresponde inicia o detiene la transmision
 * usando la ULTIMA configuracion guardada (la misma que se ve en
 * Configuracion). Un enfoque de sondeo periodico es mas robusto que
 * calcular un unico setTimeout de larga duracion: se auto-corrige solo
 * ante cambios de hora del sistema, suspension del equipo, etc.
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const POLL_INTERVAL_MS = 20000;

let timer = null;
let lastTriggeredKey = null; // evita disparar la misma accion dos veces el mismo dia

function startScheduler(mainWindow) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => checkSchedule(mainWindow), POLL_INTERVAL_MS);
  checkSchedule(mainWindow);
}

function checkSchedule(mainWindow) {
  let schedule;
  try {
    schedule = scheduleStore.loadSchedule();
  } catch {
    return;
  }
  if (!schedule.enabled) return;

  const now = new Date();
  const dayKey = DAY_KEYS[now.getDay()];
  if (!schedule.days.includes(dayKey)) return;

  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayKey = now.toISOString().slice(0, 10);

  if (currentTime === schedule.startTime && lastTriggeredKey !== `start-${todayKey}` && !ffmpegStream.isStreaming()) {
    lastTriggeredKey = `start-${todayKey}`;
    sendLog(mainWindow, `Programacion automatica: iniciando transmision (${schedule.startTime}).`);
    const settings = settingsStore.loadSettings();
    ffmpegStream.startStream(mainWindow, { ...settings, recordSession: schedule.autoRecord });
  }

  if (currentTime === schedule.stopTime && lastTriggeredKey !== `stop-${todayKey}` && ffmpegStream.isStreaming()) {
    lastTriggeredKey = `stop-${todayKey}`;
    sendLog(mainWindow, `Programacion automatica: deteniendo transmision (${schedule.stopTime}).`);
    ffmpegStream.stopStream(mainWindow);
  }
}

module.exports = { startScheduler };
