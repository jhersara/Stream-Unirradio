// Renderer: solo usa la superficie expuesta en window.streamAPI (preload.js).
// No tiene acceso a Node ni a ipcRenderer directamente (contextIsolation).

const els = {
  servidor: document.getElementById('input-servidor'),
  puerto: document.getElementById('input-puerto'),
  punto: document.getElementById('input-punto'),
  usuario: document.getElementById('input-usuario'),
  password: document.getElementById('input-password'),
  device: document.getElementById('select-device'),

  checkIntro: document.getElementById('check-intro'),
  introPath: document.getElementById('input-intro-path'),
  btnBrowseIntro: document.getElementById('btn-browse-intro'),

  checkOutro: document.getElementById('check-outro'),
  outroPath: document.getElementById('input-outro-path'),
  btnBrowseOutro: document.getElementById('btn-browse-outro'),

  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  timerValue: document.getElementById('timer-value'),

  vuFill: document.getElementById('vu-fill'),
  vuDbValue: document.getElementById('vu-db-value'),

  gainSlider: document.getElementById('gain-slider'),
  gainValue: document.getElementById('gain-value'),

  introCard: document.getElementById('intro-progress-card'),
  introFill: document.getElementById('intro-progress-fill'),
  introTime: document.getElementById('intro-progress-time'),

  outroCard: document.getElementById('outro-progress-card'),
  outroFill: document.getElementById('outro-progress-fill'),
  outroTime: document.getElementById('outro-progress-time'),

  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),

  logOutput: document.getElementById('log-output')
};

const STATUS_COLORS = {
  idle: 'var(--status-idle)',
  connecting: 'var(--status-connecting)',
  live: 'var(--status-live)',
  error: 'var(--status-error)'
};

function setStatus(text, kind) {
  els.statusText.textContent = text;
  els.statusDot.style.background = STATUS_COLORS[kind] || STATUS_COLORS.idle;
}

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatShort(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function appendLog(message, timestamp) {
  const line = document.createElement('div');
  line.className = 'log-line';
  const ts = timestamp ? new Date(timestamp) : new Date();
  const hh = String(ts.getHours()).padStart(2, '0');
  const mm = String(ts.getMinutes()).padStart(2, '0');
  const ss = String(ts.getSeconds()).padStart(2, '0');
  line.textContent = `[${hh}:${mm}:${ss}] ${message}`;
  els.logOutput.appendChild(line);
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

// ---------------------------------------------------------------------------
// Dispositivos de audio (Fase 2 los llenara con datos reales via naudiodon)
// ---------------------------------------------------------------------------
async function loadDevices() {
  const devices = await window.streamAPI.listDevices();
  els.device.innerHTML = '';
  if (!devices || devices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin dispositivos disponibles (motor pendiente)';
    els.device.appendChild(opt);
    return;
  }
  devices.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    els.device.appendChild(opt);
  });
}

// ---------------------------------------------------------------------------
// Selectores de archivo (intro / outro)
// ---------------------------------------------------------------------------
els.btnBrowseIntro.addEventListener('click', async () => {
  const filePath = await window.streamAPI.selectAudioFile();
  if (filePath) {
    els.introPath.value = filePath;
    appendLog(`Archivo de intro seleccionado: ${filePath}`);
  }
});

els.btnBrowseOutro.addEventListener('click', async () => {
  const filePath = await window.streamAPI.selectAudioFile();
  if (filePath) {
    els.outroPath.value = filePath;
    appendLog(`Archivo de outro seleccionado: ${filePath}`);
  }
});

// ---------------------------------------------------------------------------
// Ganancia
// ---------------------------------------------------------------------------
els.gainSlider.addEventListener('input', () => {
  els.gainValue.textContent = `${els.gainSlider.value}%`;
});

// ---------------------------------------------------------------------------
// Iniciar / Detener
// ---------------------------------------------------------------------------
els.btnStart.addEventListener('click', async () => {
  const config = {
    server: els.servidor.value.trim(),
    port: els.puerto.value.trim(),
    mount: els.punto.value.trim(),
    user: els.usuario.value.trim(),
    password: els.password.value,
    deviceId: els.device.value,
    introEnabled: els.checkIntro.checked,
    introPath: els.introPath.value,
    outroEnabled: els.checkOutro.checked,
    outroPath: els.outroPath.value,
    gain: Number(els.gainSlider.value) / 100
  };

  if (!config.server || !config.port || !config.mount || !config.user || !config.password) {
    appendLog('Completa servidor, puerto, punto de montaje, usuario y contrasena.');
    return;
  }

  els.btnStart.disabled = true;
  els.btnStop.disabled = false;
  setStatus('Conectando...', 'connecting');

  const result = await window.streamAPI.startStream(config);
  if (!result || !result.ok) {
    // El motor todavia no esta implementado (Fase 2) o fallo la conexion.
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    setStatus('Desconectado', 'idle');
  }
});

els.btnStop.addEventListener('click', async () => {
  els.btnStop.disabled = true;
  setStatus('Desconectando...', 'connecting');
  await window.streamAPI.stopStream();
});

// ---------------------------------------------------------------------------
// Eventos desde el proceso principal
// ---------------------------------------------------------------------------
window.streamAPI.onLog((payload) => {
  appendLog(payload.message, payload.timestamp);
});

window.streamAPI.onStatus((payload) => {
  // payload: { text, kind, elapsedSeconds }
  setStatus(payload.text, payload.kind);
  if (typeof payload.elapsedSeconds === 'number') {
    els.timerValue.textContent = formatClock(payload.elapsedSeconds);
  }
  if (payload.kind === 'idle' || payload.kind === 'error') {
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
  }
});

window.streamAPI.onVuLevel((payload) => {
  // payload: { peak (0..1), db }
  const pct = Math.min(100, Math.max(0, payload.peak * 100));
  els.vuFill.style.width = `${pct}%`;
  els.vuDbValue.textContent = payload.db <= -100 ? '-inf dB' : `${payload.db.toFixed(1)} dB`;
});

window.streamAPI.onIntroProgress((payload) => {
  // payload: { elapsedSeconds, durationSeconds } o { done: true }
  if (payload.done) {
    els.introCard.hidden = true;
    return;
  }
  els.introCard.hidden = false;
  const pct = payload.durationSeconds > 0
    ? Math.min(100, (payload.elapsedSeconds / payload.durationSeconds) * 100)
    : 0;
  els.introFill.style.width = `${pct}%`;
  els.introTime.textContent = `${formatShort(payload.elapsedSeconds)} / ${formatShort(payload.durationSeconds)}`;
});

window.streamAPI.onOutroProgress((payload) => {
  // payload: { elapsedSeconds, durationSeconds } o { done: true }
  if (payload.done) {
    els.outroCard.hidden = true;
    return;
  }
  els.outroCard.hidden = false;
  const pct = payload.durationSeconds > 0
    ? Math.min(100, (payload.elapsedSeconds / payload.durationSeconds) * 100)
    : 0;
  els.outroFill.style.width = `${pct}%`;
  els.outroTime.textContent = `${formatShort(payload.elapsedSeconds)} / ${formatShort(payload.durationSeconds)}`;
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
loadDevices();
appendLog('Interfaz cargada. Motor de streaming pendiente (Fase 2).');
