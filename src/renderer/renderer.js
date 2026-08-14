// Renderer: solo usa la superficie expuesta en window.streamAPI (preload.js)
// mas los helpers locales window.renderIcon (icons.js) y window.SoundFX
// (sound-fx.js). Sin acceso a Node ni a ipcRenderer directamente.

const VU_SEGMENT_COUNT = 28;
const MIC_TEST_SEGMENT_COUNT = 20;

const els = {
  // Activity bar
  navItems: Array.from(document.querySelectorAll('.activity-item')),
  views: Array.from(document.querySelectorAll('.view')),
  activityUpdateBadge: document.getElementById('activity-update-badge'),

  // Estudio
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

  btnTestMic: document.getElementById('btn-test-mic'),
  micTestMeter: document.getElementById('mic-test-meter'),
  micTestDb: document.getElementById('mic-test-db'),

  checkIntro: document.getElementById('check-intro'),
  checkOutro: document.getElementById('check-outro'),

  // Biblioteca (lista unica: cualquier pista sirve como intro o outro)
  btnImportTrack: document.getElementById('btn-import-track'),
  trackList: document.getElementById('track-list'),

  // Historial
  historyList: document.getElementById('history-list'),

  // Informacion
  aboutVersion: document.getElementById('about-version'),
  btnCheckUpdates: document.getElementById('btn-check-updates'),
  updateStatus: document.getElementById('update-status'),

  // Status bar
  statusBar: document.getElementById('status-bar'),
  statusbarDot: document.getElementById('statusbar-dot'),
  statusbarText: document.getElementById('statusbar-text'),
  statusbarTimer: document.getElementById('statusbar-timer'),
  statusbarGain: document.getElementById('statusbar-gain'),
  statusbarVersion: document.getElementById('statusbar-version'),

  // Modal generico
  modalOverlay: document.getElementById('app-modal-overlay'),
  modalTitle: document.getElementById('app-modal-title'),
  modalMessage: document.getElementById('app-modal-message'),
  modalActions: document.getElementById('app-modal-actions')
};

let libraryCache = { tracks: [] };
let micTestActive = false;
let latestUpdateInfo = null;

// ---------------------------------------------------------------------------
// Iconos: cualquier elemento con [data-icon="nombre"] recibe el SVG.
// ---------------------------------------------------------------------------
function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    el.innerHTML = window.renderIcon(name, el.classList.contains('activity-icon') ? 20 : 15);
  });
}

// ---------------------------------------------------------------------------
// Navegacion entre vistas
// ---------------------------------------------------------------------------
function switchView(viewName) {
  els.navItems.forEach((btn) => {
    btn.classList.toggle('activity-item-active', btn.dataset.view === viewName);
  });
  els.views.forEach((section) => {
    section.classList.toggle('view-active', section.dataset.viewPanel === viewName);
  });

  if (viewName === 'history') {
    loadHistory();
  }

  // La prueba de microfono usa el mismo dispositivo que tomaria una
  // transmision real; se detiene sola al salir de Configuracion para no
  // dejar el microfono "ocupado" sin que se note.
  if (viewName !== 'config' && micTestActive) {
    stopMicTest();
  }
}

els.navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    window.SoundFX.click();
    switchView(btn.dataset.view);
  });
});

// ---------------------------------------------------------------------------
// Modal generico (confirmar grabacion, avisos de actualizacion)
// ---------------------------------------------------------------------------
function showModal({ title, message, actions, dismissible = true }) {
  els.modalTitle.textContent = title;
  els.modalMessage.textContent = message;
  els.modalActions.innerHTML = '';
  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = action.className || 'btn-secondary';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      hideModal();
      if (action.onClick) action.onClick();
    });
    els.modalActions.appendChild(btn);
  });
  els.modalOverlay.hidden = false;
  els.modalOverlay.dataset.dismissible = dismissible ? '1' : '0';
}

function hideModal() {
  els.modalOverlay.hidden = true;
}

els.modalOverlay.addEventListener('click', (event) => {
  if (event.target !== els.modalOverlay) return;
  if (els.modalOverlay.dataset.dismissible !== '1') return;
  hideModal();
});

// ---------------------------------------------------------------------------
// Vumetro segmentado (reutilizado para el vumetro real y la prueba de mic)
// ---------------------------------------------------------------------------
function buildSegmentedMeter(container, count) {
  container.innerHTML = '';
  for (let i = 0; i < count; i += 1) {
    const seg = document.createElement('div');
    seg.className = 'vu-segment';
    container.appendChild(seg);
  }
}

function updateSegmentedMeter(container, count, peak) {
  const segments = container.children;
  const litCount = Math.round(Math.min(1, Math.max(0, peak)) * count);
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    seg.classList.remove('is-lit-green', 'is-lit-yellow', 'is-lit-red');
    if (i < litCount) {
      const ratio = i / count;
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

function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
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
  idle: { dotClass: '', text: 'Desconectado', sub: 'Listo para transmitir' },
  connecting: { dotClass: 'is-connecting', text: 'Conectando...', sub: 'Estableciendo conexion con el servidor' },
  intro: { dotClass: 'is-connecting', text: 'Reproduciendo Intro', sub: 'La transmision en vivo comienza al terminar' },
  live: { dotClass: 'is-live', text: 'En Vivo', sub: 'Transmitiendo audio en tiempo real' },
  outro: { dotClass: 'is-connecting', text: 'Reproduciendo Outro', sub: 'La conexion se cerrara 2s antes de que termine' },
  error: { dotClass: 'is-live', text: 'Error de Conexion', sub: 'Revisa el registro de actividad' }
};

function setOnAirState(kind, elapsedSeconds) {
  const preset = STATUS_PRESETS[kind] || STATUS_PRESETS.idle;
  els.onairDot.className = `onair-dot ${preset.dotClass}`.trim();
  els.onairStatus.textContent = preset.text;
  els.onairSubstatus.textContent = preset.sub;

  els.statusbarDot.className = `statusbar-dot ${preset.dotClass}`.trim();
  els.statusbarText.textContent = preset.text;
  els.statusBar.classList.toggle('is-live', kind === 'live' || kind === 'error');

  if (typeof elapsedSeconds === 'number') {
    els.onairTimer.textContent = formatClock(elapsedSeconds);
    els.statusbarTimer.textContent = formatClock(elapsedSeconds);
  }
}

// ---------------------------------------------------------------------------
// Selector de pista personalizado (intro/outro activo). Reemplaza un
// <select> nativo porque un <option> no puede llevar HTML/estilo propio: no
// hay forma de mostrar "nombre" a la izquierda y "duracion" bien resaltada
// a la derecha dentro de un <select> normal. Aqui cada fila del menu
// desplegable muestra ambas cosas antes de elegir.
// ---------------------------------------------------------------------------
function createTrackPicker(root, trigger, menu, onChange) {
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
    if (onChange) onChange(id);
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
    setValue(id) {
      selectedId = currentTracks.some((t) => t.id === id) ? id : '';
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
  document.getElementById('picker-intro-menu'),
  () => persistSettings()
);
const outroPicker = createTrackPicker(
  document.getElementById('picker-outro'),
  document.getElementById('picker-outro-trigger'),
  document.getElementById('picker-outro-menu'),
  () => persistSettings()
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
// Historial de transmisiones
// ---------------------------------------------------------------------------
function renderHistoryList(sessions) {
  els.historyList.innerHTML = '';
  if (!sessions || sessions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'track-list-empty';
    empty.textContent = 'Todavia no hay transmisiones registradas.';
    els.historyList.appendChild(empty);
    return;
  }

  sessions.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const durationText = formatClock(entry.durationSeconds || 0);
    const isError = entry.endReason === 'error';
    const reasonText = isError
      ? 'Termino por error'
      : entry.endReason === 'app-closed'
        ? 'App cerrada a mitad de transmision'
        : 'Detenida manualmente';

    item.innerHTML = `
      <span class="history-item-icon">${window.renderIcon(entry.recordingPath ? 'library' : 'radio', 16)}</span>
      <div class="history-item-info">
        <span class="history-item-date">${escapeHtml(formatDateTime(entry.startedAt))}</span>
        <span class="history-item-meta${isError ? ' is-error' : ''}">${durationText} · ${escapeHtml(entry.mount || '')} · ${reasonText}</span>
      </div>
      ${entry.recordingPath ? `<button type="button" class="btn-secondary" data-reveal="${escapeHtml(entry.recordingPath)}">Abrir carpeta</button>` : ''}
    `;
    els.historyList.appendChild(item);
  });

  paintIcons(els.historyList);
}

async function loadHistory() {
  const sessions = await window.streamAPI.listHistory();
  renderHistoryList(sessions);
}

els.historyList.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-reveal]');
  if (!btn) return;
  window.SoundFX.click();
  window.streamAPI.revealRecording(btn.getAttribute('data-reveal'));
});

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
// Prueba de microfono (fuera de una transmision real): solo muestra el
// nivel de señal, no conecta a Icecast ni graba nada. Sirve para confirmar
// que el microfono elegido esta funcionando antes de salir al aire.
// ---------------------------------------------------------------------------
function setMicTestButtonLabel(isActive) {
  els.btnTestMic.innerHTML = isActive
    ? `<span class="icon-inline" data-icon="stop"></span> Detener prueba`
    : `<span class="icon-inline" data-icon="volume"></span> Probar microfono`;
  paintIcons(els.btnTestMic);
}

async function stopMicTest() {
  if (!micTestActive) return;
  await window.streamAPI.stopPreview();
  micTestActive = false;
  setMicTestButtonLabel(false);
  updateSegmentedMeter(els.micTestMeter, MIC_TEST_SEGMENT_COUNT, 0);
  els.micTestDb.textContent = '';
}

els.btnTestMic.addEventListener('click', async () => {
  window.SoundFX.click();
  if (micTestActive) {
    await stopMicTest();
    return;
  }
  const result = await window.streamAPI.startPreview(els.device.value);
  if (result && result.ok) {
    micTestActive = true;
    setMicTestButtonLabel(true);
  } else {
    window.SoundFX.error();
    appendLog('No se pudo iniciar la prueba de microfono (revisa que no haya una transmision activa).');
  }
});

// ---------------------------------------------------------------------------
// Info de la app
// ---------------------------------------------------------------------------
async function loadAppInfo() {
  const info = await window.streamAPI.getAppInfo();
  els.statusbarVersion.textContent = `v${info.version}`;
  els.aboutVersion.textContent = `Version ${info.version}`;
}

// ---------------------------------------------------------------------------
// Actualizaciones: boton manual (vista Informacion) + popup automatico +
// insignia persistente en la barra lateral cuando el usuario cierra el
// popup sin actuar (mismo patron que usa la app de escritorio de Claude).
// ---------------------------------------------------------------------------
els.btnCheckUpdates.addEventListener('click', async () => {
  window.SoundFX.click();
  els.btnCheckUpdates.disabled = true;
  els.updateStatus.textContent = 'Buscando actualizaciones...';
  await window.streamAPI.checkForUpdates();
  els.btnCheckUpdates.disabled = false;
});

function showUpdateBadge(title) {
  els.activityUpdateBadge.hidden = false;
  els.activityUpdateBadge.title = title;
}

function openUpdateModal() {
  if (!latestUpdateInfo) return;
  if (latestUpdateInfo.state === 'downloaded') {
    showModal({
      title: 'Actualizacion lista',
      message: `La version v${latestUpdateInfo.version} ya se descargo. Reinicia la app para terminar de instalarla.`,
      actions: [
        { label: 'Mas tarde', className: 'btn-secondary' },
        { label: 'Reiniciar app', className: 'btn-primary', onClick: () => window.streamAPI.restartToUpdate() }
      ]
    });
  } else {
    showModal({
      title: 'Actualizacion disponible',
      message: `Hay una nueva version (v${latestUpdateInfo.version}) descargandose en segundo plano. Te avisamos aqui mismo cuando este lista para instalar.`,
      actions: [{ label: 'Entendido', className: 'btn-primary' }]
    });
  }
}

window.streamAPI.onUpdateState((payload) => {
  if (payload.state === 'available') {
    latestUpdateInfo = payload;
    showUpdateBadge('Actualizacion disponible - descargando...');
    openUpdateModal();
  } else if (payload.state === 'downloaded') {
    latestUpdateInfo = payload;
    showUpdateBadge('Actualizacion lista - Reiniciar app');
    openUpdateModal();
  }
});

els.activityUpdateBadge.addEventListener('click', () => {
  window.SoundFX.click();
  openUpdateModal();
});

// ---------------------------------------------------------------------------
// Ganancia
// ---------------------------------------------------------------------------
els.gainSlider.addEventListener('input', () => {
  els.gainValue.textContent = `${els.gainSlider.value}%`;
  els.statusbarGain.textContent = `Ganancia ${els.gainSlider.value}%`;
  window.streamAPI.setGain(Number(els.gainSlider.value) / 100);
});
els.gainSlider.addEventListener('change', () => persistSettings());

// ---------------------------------------------------------------------------
// Configuracion persistida (servidor, credenciales, dispositivo, pistas
// activas): se guarda sola cada vez que un campo cambia, para que el
// usuario no tenga que volver a escribirla cada vez que abre la app.
// ---------------------------------------------------------------------------
function currentConfig() {
  return {
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
}

function persistSettings() {
  window.streamAPI.saveSettings(currentConfig());
}

function applySettings(settings) {
  if (!settings) return;
  els.servidor.value = settings.server ?? '';
  els.puerto.value = settings.port ?? '';
  els.punto.value = settings.mount ?? '';
  els.usuario.value = settings.user ?? '';
  els.password.value = settings.password ?? '';
  if (settings.deviceId) els.device.value = settings.deviceId;
  els.checkIntro.checked = settings.introEnabled !== false;
  els.checkOutro.checked = settings.outroEnabled !== false;
  introPicker.setValue(settings.introTrackId || '');
  outroPicker.setValue(settings.outroTrackId || '');
  if (typeof settings.gain === 'number') {
    const pct = Math.round(settings.gain * 100);
    els.gainSlider.value = pct;
    els.gainValue.textContent = `${pct}%`;
    els.statusbarGain.textContent = `Ganancia ${pct}%`;
  }
}

[
  els.servidor, els.puerto, els.punto, els.usuario, els.password, els.device
].forEach((el) => el.addEventListener('change', () => persistSettings()));
els.checkIntro.addEventListener('change', () => persistSettings());
els.checkOutro.addEventListener('change', () => persistSettings());

// ---------------------------------------------------------------------------
// Iniciar / Detener
// ---------------------------------------------------------------------------
async function actuallyStartStream(config, recordSession) {
  config.recordSession = recordSession;
  persistSettings();
  window.SoundFX.start();
  els.btnStart.disabled = true;
  els.btnStop.disabled = false;
  setOnAirState('connecting');

  // Si el microfono estaba en modo prueba, el proceso principal lo detiene
  // solo al arrancar la sesion real; solo hace falta refrescar el boton.
  if (micTestActive) {
    micTestActive = false;
    setMicTestButtonLabel(false);
  }

  const result = await window.streamAPI.startStream(config);
  if (!result || !result.ok) {
    window.SoundFX.error();
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    setOnAirState('idle', 0);
  }
}

els.btnStart.addEventListener('click', () => {
  const config = currentConfig();

  if (!config.server || !config.port || !config.mount || !config.user || !config.password) {
    window.SoundFX.error();
    appendLog('Completa servidor, puerto, punto de montaje, usuario y contrasena en Configuracion.');
    return;
  }

  showModal({
    title: 'Grabar esta transmision',
    message: '¿Quieres guardar tambien un archivo local (mp3) de esta transmision, ademas de enviarla a Zeno.fm? Se guarda en tu carpeta de Documentos.',
    dismissible: false,
    actions: [
      { label: 'No, solo transmitir', className: 'btn-secondary', onClick: () => actuallyStartStream(config, false) },
      { label: 'Si, grabar', className: 'btn-primary', onClick: () => actuallyStartStream(config, true) }
    ]
  });
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
  if (els.updateStatus && /actualiz/i.test(payload.message)) {
    els.updateStatus.textContent = payload.message;
  }
});

window.streamAPI.onStatus((payload) => {
  // payload: { kind, elapsedSeconds }
  setOnAirState(payload.kind, payload.elapsedSeconds);
  if (payload.kind === 'live') window.SoundFX.success();
  if (payload.kind === 'error') window.SoundFX.error();
  if (payload.kind === 'idle' || payload.kind === 'error') {
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    // Si la vista de Historial esta visible, refrescarla para que la
    // sesion recien terminada aparezca de inmediato.
    const historyView = document.querySelector('[data-view-panel="history"]');
    if (historyView && historyView.classList.contains('view-active')) {
      loadHistory();
    }
  }
});

window.streamAPI.onVuLevel((payload) => {
  // payload: { peak (0..1), db }
  updateSegmentedMeter(els.vuMeter, VU_SEGMENT_COUNT, payload.peak);
  els.vuDbValue.textContent = payload.db <= -100 ? '-inf dB' : `${payload.db.toFixed(1)} dB`;
});

window.streamAPI.onPreviewVuLevel((payload) => {
  updateSegmentedMeter(els.micTestMeter, MIC_TEST_SEGMENT_COUNT, payload.peak);
  els.micTestDb.textContent = payload.db <= -100 ? '-inf dB' : `${payload.db.toFixed(1)} dB`;
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
async function bootstrap() {
  paintIcons();
  buildSegmentedMeter(els.vuMeter, VU_SEGMENT_COUNT);
  buildSegmentedMeter(els.micTestMeter, MIC_TEST_SEGMENT_COUNT);
  await loadDevices();
  await loadLibrary();
  // La configuracion guardada se aplica DESPUES de cargar la biblioteca:
  // los pickers de intro/outro necesitan sus opciones (setTracks) listas
  // antes de poder marcar el track guardado como seleccionado (setValue).
  const settings = await window.streamAPI.loadSettings();
  applySettings(settings);
  await loadAppInfo();
  appendLog('Interfaz cargada.');
}

bootstrap();
