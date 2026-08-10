// Renderer: solo usa la superficie expuesta en window.streamAPI (preload.js)
// mas los helpers locales window.renderIcon (icons.js) y window.SoundFX
// (sound-fx.js). Sin acceso a Node ni a ipcRenderer directamente.

const VU_SEGMENT_COUNT = 28;

const els = {
  // Sidebar
  sidebarVersion: document.getElementById('sidebar-version'),
  navItems: Array.from(document.querySelectorAll('.nav-item')),
  views: Array.from(document.querySelectorAll('.view')),

  // Estudio
  onairBadge: document.getElementById('onair-badge'),
  onairDot: document.getElementById('onair-dot'),
  onairStatus: document.getElementById('onair-status'),
  onairSubstatus: document.getElementById('onair-substatus'),
  onairTimer: document.getElementById('onair-timer'),

  vuMeter: document.getElementById('vu-meter'),
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

  logOutput: document.getElementById('log-output'),

  // Configuracion
  servidor: document.getElementById('input-servidor'),
  puerto: document.getElementById('input-puerto'),
  punto: document.getElementById('input-punto'),
  usuario: document.getElementById('input-usuario'),
  password: document.getElementById('input-password'),
  device: document.getElementById('select-device'),

  checkIntro: document.getElementById('check-intro'),
  checkOutro: document.getElementById('check-outro'),

  // Biblioteca (lista unica: cualquier pista sirve como intro o outro)
  btnImportTrack: document.getElementById('btn-import-track'),
  trackList: document.getElementById('track-list'),

  // Informacion
  aboutVersion: document.getElementById('about-version')
};

let libraryCache = { tracks: [] };

// ---------------------------------------------------------------------------
// Iconos: cualquier elemento con [data-icon="nombre"] recibe el SVG.
// ---------------------------------------------------------------------------
function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    el.innerHTML = window.renderIcon(name, el.classList.contains('nav-icon') ? 18 : 15);
  });
}

// ---------------------------------------------------------------------------
// Navegacion entre vistas
// ---------------------------------------------------------------------------
function switchView(viewName) {
  els.navItems.forEach((btn) => {
    btn.classList.toggle('nav-item-active', btn.dataset.view === viewName);
  });
  els.views.forEach((section) => {
    section.classList.toggle('view-active', section.dataset.viewPanel === viewName);
  });
}

els.navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    window.SoundFX.click();
    switchView(btn.dataset.view);
  });
});

// ---------------------------------------------------------------------------
// Vumetro segmentado
// ---------------------------------------------------------------------------
function buildVuMeter() {
  els.vuMeter.innerHTML = '';
  for (let i = 0; i < VU_SEGMENT_COUNT; i += 1) {
    const seg = document.createElement('div');
    seg.className = 'vu-segment';
    els.vuMeter.appendChild(seg);
  }
}

function updateVuMeter(peak) {
  const segments = els.vuMeter.children;
  const litCount = Math.round(Math.min(1, Math.max(0, peak)) * VU_SEGMENT_COUNT);
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    seg.classList.remove('is-lit-green', 'is-lit-yellow', 'is-lit-red');
    if (i < litCount) {
      const ratio = i / VU_SEGMENT_COUNT;
      if (ratio < 0.6) seg.classList.add('is-lit-green');
      else if (ratio < 0.85) seg.classList.add('is-lit-yellow');
      else seg.classList.add('is-lit-red');
    }
  }
}

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------
function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatShort(totalSeconds) {
  if (totalSeconds == null) return '--:--';
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
// Estado "en vivo" (hero)
// ---------------------------------------------------------------------------
const STATUS_PRESETS = {
  idle: { dotClass: '', badgeClass: '', text: 'Desconectado', sub: 'Listo para transmitir' },
  connecting: { dotClass: 'is-connecting', badgeClass: 'is-connecting', text: 'Conectando...', sub: 'Estableciendo conexion con el servidor' },
  intro: { dotClass: 'is-connecting', badgeClass: 'is-connecting', text: 'Reproduciendo Intro', sub: 'La transmision en vivo comienza al terminar' },
  live: { dotClass: 'is-live', badgeClass: 'is-live', text: 'En Vivo', sub: 'Transmitiendo audio en tiempo real' },
  outro: { dotClass: 'is-connecting', badgeClass: 'is-connecting', text: 'Reproduciendo Outro', sub: 'La conexion se cerrara 2s antes de que termine' },
  error: { dotClass: 'is-live', badgeClass: 'is-live', text: 'Error de Conexion', sub: 'Revisa el registro de actividad' }
};

function setOnAirState(kind, elapsedSeconds) {
  const preset = STATUS_PRESETS[kind] || STATUS_PRESETS.idle;
  els.onairDot.className = `onair-dot ${preset.dotClass}`.trim();
  els.onairBadge.className = `onair-badge ${preset.badgeClass}`.trim();
  els.onairStatus.textContent = preset.text;
  els.onairSubstatus.textContent = preset.sub;
  if (typeof elapsedSeconds === 'number') {
    els.onairTimer.textContent = formatClock(elapsedSeconds);
  }
}

// ---------------------------------------------------------------------------
// Selector de pista personalizado (intro/outro activo). Reemplaza un
// <select> nativo porque un <option> no puede llevar HTML/estilo propio: no
// hay forma de mostrar "nombre" a la izquierda y "duracion" bien resaltada
// a la derecha dentro de un <select> normal. Aqui cada fila del menu
// desplegable muestra ambas cosas antes de elegir.
// ---------------------------------------------------------------------------
function createTrackPicker(root, trigger, menu) {
  const textEl = trigger.querySelector('.track-picker-trigger-text');
  const durationEl = trigger.querySelector('.track-picker-trigger-duration');
  let currentTracks = [];
  let selectedId = '';

  function close() {
    root.classList.remove('is-open');
    menu.hidden = true;
  }

  function open() {
    if (trigger.disabled) return;
    root.classList.add('is-open');
    menu.hidden = false;
  }

  function select(id) {
    selectedId = id;
    close();
    renderTrigger();
    renderMenu();
  }

  function renderTrigger() {
    if (selectedId === '') {
      textEl.textContent = currentTracks.length === 0 ? 'Sin pistas en la biblioteca' : 'Ninguna';
      durationEl.textContent = '';
      return;
    }
    const track = currentTracks.find((t) => t.id === selectedId);
    if (!track) {
      selectedId = '';
      textEl.textContent = currentTracks.length === 0 ? 'Sin pistas en la biblioteca' : 'Ninguna';
      durationEl.textContent = '';
      return;
    }
    textEl.textContent = track.name;
    durationEl.textContent = formatShort(track.durationSeconds);
  }

  function renderMenu() {
    menu.innerHTML = '';

    const noneOption = document.createElement('div');
    noneOption.className = `track-picker-option${selectedId === '' ? ' is-selected' : ''}`;
    noneOption.innerHTML = `
      <span class="track-picker-option-check">${window.renderIcon('check', 13)}</span>
      <span class="track-picker-option-name">Ninguna</span>
    `;
    noneOption.addEventListener('click', () => select(''));
    menu.appendChild(noneOption);

    currentTracks.forEach((track) => {
      const opt = document.createElement('div');
      opt.className = `track-picker-option${selectedId === track.id ? ' is-selected' : ''}`;
      opt.innerHTML = `
        <span class="track-picker-option-check">${window.renderIcon('check', 13)}</span>
        <span class="track-picker-option-name">${escapeHtml(track.name)}</span>
        <span class="track-picker-option-duration">${formatShort(track.durationSeconds)}</span>
      `;
      opt.addEventListener('click', () => select(track.id));
      menu.appendChild(opt);
    });
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (trigger.disabled) return;
    window.SoundFX.click();
    if (menu.hidden) open(); else close();
  });

  return {
    setTracks(tracks) {
      currentTracks = tracks || [];
      trigger.disabled = currentTracks.length === 0;
      if (selectedId !== '' && !currentTracks.some((t) => t.id === selectedId)) {
        selectedId = '';
      }
      renderTrigger();
      renderMenu();
    },
    getValue() {
      return selectedId;
    },
    close
  };
}

const introPicker = createTrackPicker(
  document.getElementById('picker-intro'),
  document.getElementById('picker-intro-trigger'),
  document.getElementById('picker-intro-menu')
);
const outroPicker = createTrackPicker(
  document.getElementById('picker-outro'),
  document.getElementById('picker-outro-trigger'),
  document.getElementById('picker-outro-menu')
);

// Cualquier click fuera de un picker abierto lo cierra.
document.addEventListener('click', () => {
  introPicker.close();
  outroPicker.close();
});

// ---------------------------------------------------------------------------
// Biblioteca de pistas (lista unica: cualquier pista importada sirve como
// intro, como outro, o ambas — la eleccion se hace en Configuracion).
// ---------------------------------------------------------------------------
function renderTrackList(container, tracks) {
  container.innerHTML = '';
  if (!tracks || tracks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'track-list-empty';
    empty.textContent = 'No hay pistas guardadas todavia.';
    container.appendChild(empty);
    return;
  }

  tracks.forEach((track) => {
    const item = document.createElement('div');
    item.className = 'track-item';
    item.innerHTML = `
      <span class="track-item-icon">${window.renderIcon('library', 16)}</span>
      <div class="track-item-info">
        <span class="track-item-name">${escapeHtml(track.name)}</span>
        <span class="track-item-meta">${formatShort(track.durationSeconds)}</span>
      </div>
      <button type="button" class="btn-icon-only" data-delete-id="${track.id}" title="Eliminar">
        ${window.renderIcon('trash', 14)}
      </button>
    `;
    container.appendChild(item);
  });
}

function refreshLibraryUI() {
  renderTrackList(els.trackList, libraryCache.tracks);
  introPicker.setTracks(libraryCache.tracks);
  outroPicker.setTracks(libraryCache.tracks);
  paintIcons(els.trackList);
}

async function loadLibrary() {
  libraryCache = await window.streamAPI.listLibrary();
  refreshLibraryUI();
}

els.btnImportTrack.addEventListener('click', async () => {
  window.SoundFX.click();
  const result = await window.streamAPI.importTracks();
  if (result.imported > 0) {
    window.SoundFX.success();
    appendLog(`${result.imported} pista${result.imported === 1 ? '' : 's'} agregada${result.imported === 1 ? '' : 's'} a la biblioteca.`);
  }
  libraryCache = result.library;
  refreshLibraryUI();
});

function handleLibraryDeleteClick(event) {
  const btn = event.target.closest('[data-delete-id]');
  if (!btn) return;
  window.SoundFX.click();
  const id = btn.getAttribute('data-delete-id');
  window.streamAPI.deleteTrack(id).then((library) => {
    libraryCache = library;
    refreshLibraryUI();
    appendLog('Pista eliminada de la biblioteca.');
  });
}

els.trackList.addEventListener('click', handleLibraryDeleteClick);

// ---------------------------------------------------------------------------
// Dispositivos de audio
// ---------------------------------------------------------------------------
async function loadDevices() {
  const devices = await window.streamAPI.listDevices();
  els.device.innerHTML = '';
  if (!devices || devices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin dispositivos disponibles';
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
// Info de la app
// ---------------------------------------------------------------------------
async function loadAppInfo() {
  const info = await window.streamAPI.getAppInfo();
  els.sidebarVersion.textContent = `v${info.version}`;
  els.aboutVersion.textContent = `Version ${info.version}`;
}

// ---------------------------------------------------------------------------
// Ganancia
// ---------------------------------------------------------------------------
els.gainSlider.addEventListener('input', () => {
  els.gainValue.textContent = `${els.gainSlider.value}%`;
  window.streamAPI.setGain(Number(els.gainSlider.value) / 100);
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
    introTrackId: introPicker.getValue(),
    outroEnabled: els.checkOutro.checked,
    outroTrackId: outroPicker.getValue(),
    gain: Number(els.gainSlider.value) / 100
  };

  if (!config.server || !config.port || !config.mount || !config.user || !config.password) {
    window.SoundFX.error();
    appendLog('Completa servidor, puerto, punto de montaje, usuario y contrasena en Configuracion.');
    return;
  }

  window.SoundFX.start();
  els.btnStart.disabled = true;
  els.btnStop.disabled = false;
  setOnAirState('connecting');

  const result = await window.streamAPI.startStream(config);
  if (!result || !result.ok) {
    window.SoundFX.error();
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    setOnAirState('idle', 0);
  }
});

els.btnStop.addEventListener('click', async () => {
  window.SoundFX.stop();
  els.btnStop.disabled = true;
  setOnAirState('outro');
  await window.streamAPI.stopStream();
});

// ---------------------------------------------------------------------------
// Eventos desde el proceso principal
// ---------------------------------------------------------------------------
window.streamAPI.onLog((payload) => {
  appendLog(payload.message, payload.timestamp);
});

window.streamAPI.onStatus((payload) => {
  // payload: { kind, elapsedSeconds }
  setOnAirState(payload.kind, payload.elapsedSeconds);
  if (payload.kind === 'live') window.SoundFX.success();
  if (payload.kind === 'error') window.SoundFX.error();
  if (payload.kind === 'idle' || payload.kind === 'error') {
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
  }
});

window.streamAPI.onVuLevel((payload) => {
  // payload: { peak (0..1), db }
  updateVuMeter(payload.peak);
  els.vuDbValue.textContent = payload.db <= -100 ? '-inf dB' : `${payload.db.toFixed(1)} dB`;
});

window.streamAPI.onIntroProgress((payload) => {
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
paintIcons();
buildVuMeter();
loadDevices();
loadLibrary();
loadAppInfo();
appendLog('Interfaz cargada.');
