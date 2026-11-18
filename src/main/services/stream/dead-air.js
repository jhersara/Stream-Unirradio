const { SILENCE_PEAK_THRESHOLD, DEAD_AIR_SECONDS } = require('./constants');
const { sendLog, sendDeadAir } = require('../../ipc/events');

/**
 * Deteccion de "aire muerto": si el pico se mantiene bajo el umbral durante
 * mas de DEAD_AIR_SECONDS se avisa una vez; al volver la senal se avisa la
 * recuperacion.
 */
function checkDeadAir(session, peak, now) {
  if (peak < SILENCE_PEAK_THRESHOLD) {
    if (!session.silenceSince) session.silenceSince = now;
    const silentForSeconds = (now - session.silenceSince) / 1000;
    if (silentForSeconds >= DEAD_AIR_SECONDS && !session.deadAirActive) {
      session.deadAirActive = true;
      sendLog(session.mainWindow, `ALERTA: no se detecta audio desde hace ${Math.round(silentForSeconds)}s. Revisa el microfono.`);
      sendDeadAir(session.mainWindow, true);
    }
    return;
  }

  if (session.deadAirActive) {
    sendLog(session.mainWindow, 'Audio detectado de nuevo; todo normal.');
    sendDeadAir(session.mainWindow, false);
  }
  session.silenceSince = null;
  session.deadAirActive = false;
}

module.exports = { checkDeadAir };
