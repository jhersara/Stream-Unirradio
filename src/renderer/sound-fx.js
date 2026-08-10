/**
 * Efectos de sonido de la interfaz, sintetizados con Web Audio API (sin
 * archivos de audio externos: evita cualquier problema de licencias y
 * mantiene la app 100% autocontenida). El AudioContext se crea de forma
 * perezosa en el primer sonido, porque los navegadores/Electron requieren
 * un gesto del usuario (click) antes de permitir audio.
 */
(function () {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioContextClass();
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  function tone(freq, startTime, duration, type, gainPeak) {
    const audioCtx = getCtx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(gainPeak || 0.06, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  window.SoundFX = {
    click() {
      const audioCtx = getCtx();
      tone(1100, audioCtx.currentTime, 0.045, 'sine', 0.045);
    },
    toggle() {
      const audioCtx = getCtx();
      tone(750, audioCtx.currentTime, 0.06, 'sine', 0.05);
    },
    success() {
      const audioCtx = getCtx();
      const now = audioCtx.currentTime;
      tone(660, now, 0.12, 'sine', 0.06);
      tone(990, now + 0.1, 0.16, 'sine', 0.06);
    },
    start() {
      const audioCtx = getCtx();
      const now = audioCtx.currentTime;
      tone(440, now, 0.1, 'triangle', 0.07);
      tone(660, now + 0.09, 0.12, 'triangle', 0.07);
      tone(880, now + 0.18, 0.2, 'triangle', 0.07);
    },
    stop() {
      const audioCtx = getCtx();
      const now = audioCtx.currentTime;
      tone(660, now, 0.1, 'triangle', 0.06);
      tone(440, now + 0.09, 0.16, 'triangle', 0.06);
    },
    error() {
      const audioCtx = getCtx();
      const now = audioCtx.currentTime;
      tone(220, now, 0.18, 'sawtooth', 0.05);
      tone(180, now + 0.12, 0.22, 'sawtooth', 0.05);
    }
  };
})();
