// Renderer: solo usa la superficie expuesta en window.streamAPI (preload.js)
// mas los helpers locales window.renderIcon (icons.js) y window.SoundFX
// (sound-fx.js). Sin acceso a Node ni a ipcRenderer directamente.

const VU_SEGMENT_COUNT = 28;
const MIC_TEST_SEGMENT_COUNT = 20;
const SPECTRUM_BAND_COUNT = 24;

const els = {
  // Activity bar
  navItems: Array.from(document.querySelectorAll('.activity-item')),
  views: Array.from(document.querySelectorAll('.view')),
  activityUpdateBadge: document.getElementById('activity-update-badge'),
  topbarContextTitle: document.getElementById('topbar-context-title'),
  topbarStatusDot: document.getElementById('topbar-status-dot'),
  topbarStatusText: document.getElementById('topbar-status-text'),
  appShell: document.querySelector('.app-shell'),
  navigationToggle: document.getElementById('btn-toggle-navigation'),

  // Estudio
  onairDot: document.getElementById('onair-dot'),
  onairStatus: document.getElementById('onair-status'),
  onairSubstatus: document.getElementById('onair-substatus'),
  onairTimer: document.getElementById('onair-timer'),
  deadAirBanner: document.getElementById('dead-air-banner'),

  vuMeter: document.getElementById('vu-meter'),
  vuDbValue: document.getElementById('vu-db-value'),
  vuRmsValue: document.getElementById('vu-rms-value'),
  vuPeakValue: document.getElementById('vu-peak-value'),
  vuStereoValue: document.getElementById('vu-stereo-value'),
  vuClipIndicator: document.getElementById('vu-clip-indicator'),
  signalQuality: document.getElementById('signal-quality'),
  spectrumMeter: document.getElementById('spectrum-meter'),

  gainSlider: document.getElementById('gain-slider'),
  gainValue: document.getElementById('gain-value'),

  introCard: document.getElementById('intro-progress-card'),
  introFill: document.getElementById('intro-progress-fill'),
  introTime: document.getElementById('intro-progress-time'),

  outroCard: document.getElementById('outro-progress-card'),
  outroFill: document.getElementById('outro-progress-fill'),
  outroTime: document.getElementById('outro-progress-time'),

  btnStart: document.getElementById('btn-start'),
  btnPause: document.getElementById('btn-pause'),
  btnPauseLabel: document.getElementById('btn-pause-label'),
  btnStop: document.getElementById('btn-stop'),

  logOutput: document.getElementById('log-output'),

  // Configuracion
  providerSelect: document.getElementById('select-provider'),
  providerProtocolPill: document.getElementById('provider-protocol-pill'),
  providerHelp: document.getElementById('provider-help'),
  labelUsuario: document.getElementById('label-usuario'),
  providerValidation: document.getElementById('provider-validation'),
  providerValidationText: document.getElementById('provider-validation-text'),
  fieldMount: document.getElementById('field-mount'),
  fieldStreamId: document.getElementById('field-stream-id'),
  labelPunto: document.getElementById('label-punto'),
  streamId: document.getElementById('input-stream-id'),
  togglePassword: document.getElementById('btn-toggle-password'),
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

  // Programacion automatica
  checkScheduleEnabled: document.getElementById('check-schedule-enabled'),
  scheduleStart: document.getElementById('schedule-start'),
  scheduleStop: document.getElementById('schedule-stop'),
  dayPicker: document.getElementById('day-picker'),
  checkScheduleRecord: document.getElementById('check-schedule-record'),

  // Biblioteca (lista unica: cualquier pista sirve como intro o outro)
  btnImportTrack: document.getElementById('btn-import-track'),
  trackList: document.getElementById('track-list'),

  // Podcast Studio
  btnNewEpisode: document.getElementById('btn-new-episode'),
  btnEmptyNewEpisode: document.getElementById('btn-empty-new-episode'),
  episodeCount: document.getElementById('episode-count'),
  episodeList: document.getElementById('episode-list'),
  podcastEditor: document.getElementById('podcast-editor'),
  podcastEmptyState: document.getElementById('podcast-empty-state'),
  episodeEditorTitle: document.getElementById('episode-editor-title'),
  episodeStatusPill: document.getElementById('episode-status-pill'),
  episodeTitle: document.getElementById('episode-title'),
  episodeDescription: document.getElementById('episode-description'),
  podcastTimeline: document.getElementById('podcast-timeline'),
  timelineDuration: document.getElementById('timeline-duration'),
  btnClearTimeline: document.getElementById('btn-clear-timeline'),
  podcastClipLibrary: document.getElementById('podcast-clip-library'),
  btnDeleteEpisode: document.getElementById('btn-delete-episode'),
  btnSaveEpisode: document.getElementById('btn-save-episode'),
  btnExportEpisode: document.getElementById('btn-export-episode'),
  podcastExportStatus: document.getElementById('podcast-export-status'),
  podcastExportLabel: document.getElementById('podcast-export-label'),
  podcastExportPercent: document.getElementById('podcast-export-percent'),
  podcastExportFill: document.getElementById('podcast-export-fill'),
  podcastExportMeta: document.getElementById('podcast-export-meta'),
  btnCancelExport: document.getElementById('btn-cancel-export'),
  recordVoiceButton: document.getElementById('btn-record-voice'),
  recordButtonLabel: document.getElementById('record-button-label'),
  recordingStatePill: document.getElementById('recording-state-pill'),
  recordingTimer: document.getElementById('recording-timer'),
  recordingMeter: document.getElementById('recording-meter'),
  recordingDb: document.getElementById('recording-db'),
  recordingRms: document.getElementById('recording-rms'),
  recordingHelp: document.getElementById('recording-help'),
  btnMeasureMix: document.getElementById('btn-measure-mix'),
  mixDuckingEnabled: document.getElementById('mix-ducking-enabled'),
  mixDuckAmount: document.getElementById('mix-duck-amount'),
  mixDuckAmountOutput: document.getElementById('mix-duck-amount-output'),
  mixDuckThreshold: document.getElementById('mix-duck-threshold'),
  mixDuckThresholdOutput: document.getElementById('mix-duck-threshold-output'),
  mixRmsVoice: document.getElementById('mix-rms-voice'),
  mixLufsVoice: document.getElementById('mix-lufs-voice'),
  mixPeakVoice: document.getElementById('mix-peak-voice'),
  mixRmsMusic: document.getElementById('mix-rms-music'),
  mixLufsMusic: document.getElementById('mix-lufs-music'),
  mixPeakMusic: document.getElementById('mix-peak-music'),
  mixRmsIdentity: document.getElementById('mix-rms-identity'),
  mixLufsIdentity: document.getElementById('mix-lufs-identity'),
  mixPeakIdentity: document.getElementById('mix-peak-identity'),
  mixSegmentsVoice: document.getElementById('mix-segments-voice'),
  mixSegmentsMusic: document.getElementById('mix-segments-music'),
  mixSegmentsIdentity: document.getElementById('mix-segments-identity'),

  // Historial
  historyList: document.getElementById('history-list'),

  // Informacion
  aboutVersion: document.getElementById('about-version'),
  btnCheckUpdates: document.getElementById('btn-check-updates'),
  updateStatus: document.getElementById('update-status'),
  updateProgress: document.getElementById('update-progress'),
  updateProgressFill: document.getElementById('update-progress-fill'),
  updateProgressLabel: document.getElementById('update-progress-label'),
  updateProgressMeta: document.getElementById('update-progress-meta'),
  updateStatePill: document.getElementById('update-state-pill'),
  btnRestartUpdate: document.getElementById('btn-restart-update'),

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
  modalActions: document.getElementById('app-modal-actions'),

  // Modo mini-ventana
  appShell: document.querySelector('.app-shell'),
  compactBar: document.getElementById('compact-bar'),
  compactDot: document.getElementById('compact-dot'),
  compactStatus: document.getElementById('compact-status'),
  compactTimer: document.getElementById('compact-timer'),
  btnToggleCompact: document.getElementById('btn-toggle-compact'),
  btnCompactStop: document.getElementById('btn-compact-stop'),
  btnCompactRestore: document.getElementById('btn-compact-restore')
};

let libraryCache = { tracks: [] };
let micTestActive = false;
let latestUpdateInfo = null;
let isCompactMode = false;
const previewAudio = new Audio();
let previewingTrackId = null;
let previewRequestToken = 0;
let lastProviderId = 'zeno-icecast';
let providerCatalog = [
  { id: 'zeno-icecast', label: 'Zeno.fm · Icecast', shortLabel: 'Zeno.fm', protocol: 'icecast', requiresUser: true, requiresMount: true, defaultPort: '80', defaultUser: 'source', serverPlaceholder: 'link.zeno.fm', mountPlaceholder: 'Copiar exactamente desde Broadcast Settings de Zeno.fm', help: 'Usa el servidor, puerto, mountpoint y contraseña que aparecen en Broadcast Settings de Zeno.fm.' },
  { id: 'centova-icecast', label: 'Centova Cast · Icecast', shortLabel: 'Centova · Icecast', protocol: 'icecast', requiresUser: true, requiresMount: true, defaultPort: '8000', defaultUser: 'source', serverPlaceholder: 'stream.tuservidor.com', mountPlaceholder: 'Ej. /radio.mp3', help: 'Selecciona esta opción si Live Source Connections de Centova indica Icecast y proporciona un mountpoint.' },
  { id: 'centova-shoutcast', label: 'Centova Cast · SHOUTcast', shortLabel: 'Centova · SHOUTcast', protocol: 'shoutcast', requiresUser: false, requiresMount: false, defaultPort: '8000', defaultUser: 'source', serverPlaceholder: 'stream.tuservidor.com', mountPlaceholder: 'Opcional; usa el Stream ID si tu proveedor lo solicita', help: 'Selecciona esta opción si Live Source Connections de Centova indica SHOUTcast. El usuario suele ser source; confirma la contraseña con tu proveedor.' }
];

// Motor visual de audio. Los eventos IPC solo actualizan objetivos; el pintado
// ocurre en un unico requestAnimationFrame para evitar saltos y no competir
// con el hot path de captura/FFmpeg.
const audioVisualState = {
  vuTarget: 0,
  vuDisplay: 0,
  vuPeakHold: 0,
  vuPeakHoldUntil: 0,
  spectrumTarget: new Array(SPECTRUM_BAND_COUNT).fill(0),
  spectrumDisplay: new Array(SPECTRUM_BAND_COUNT).fill(0),
  spectrumPeak: new Array(SPECTRUM_BAND_COUNT).fill(0),
  spectrumPeakUntil: new Array(SPECTRUM_BAND_COUNT).fill(0),
  lastFrameAt: 0,
  rafId: 0,
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
};

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

  const viewTitles = {
    studio: 'Centro de emisión',
    podcast: 'Podcast Studio',
    library: 'Biblioteca de audio',
    history: 'Historial operativo',
    config: 'Configuración del estudio',
    about: 'Información del sistema'
  };
  if (els.topbarContextTitle) els.topbarContextTitle.textContent = viewTitles[viewName] || 'Centro de emisión';

  if (viewName === 'history') {
    loadHistory();
  }

  // La prueba de microfono usa el mismo dispositivo que tomaria una
  // transmision real; se detiene sola al salir de Configuracion para no
  // dejar el microfono "ocupado" sin que se note.
  if (viewName !== 'config' && micTestActive) {
    stopMicTest();
  }

  if (viewName !== 'library' && viewName !== 'config') {
    stopTrackPreview();
  }
}

function isNarrowNavigation() {
  return window.matchMedia('(max-width: 820px)').matches;
}

function syncNavigationToggle() {
  if (!els.navigationToggle || !els.appShell) return;
  const narrow = isNarrowNavigation();
  if (narrow) {
    els.appShell.classList.remove('nav-collapsed');
  } else {
    els.appShell.classList.remove('nav-open');
  }
  const expanded = narrow
    ? els.appShell.classList.contains('nav-open')
    : !els.appShell.classList.contains('nav-collapsed');
  els.navigationToggle.setAttribute('aria-expanded', String(expanded));
  els.navigationToggle.setAttribute('aria-label', expanded ? 'Cerrar menú de navegación' : 'Abrir menú de navegación');
}

els.navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    window.SoundFX.click();
    switchView(btn.dataset.view);
    if (isNarrowNavigation()) {
      els.appShell.classList.remove('nav-open');
      syncNavigationToggle();
    }
  });
});

if (els.navigationToggle && els.appShell) {
  els.navigationToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    window.SoundFX.click();
    if (isNarrowNavigation()) {
      els.appShell.classList.toggle('nav-open');
    } else {
      els.appShell.classList.toggle('nav-collapsed');
    }
    syncNavigationToggle();
  });
  window.addEventListener('resize', syncNavigationToggle);
  document.addEventListener('click', (event) => {
    if (!isNarrowNavigation() || !els.appShell.classList.contains('nav-open')) return;
    const activityBar = document.querySelector('.activity-bar');
    if (activityBar && !activityBar.contains(event.target) && !els.navigationToggle.contains(event.target)) {
      els.appShell.classList.remove('nav-open');
      syncNavigationToggle();
    }
  });
  syncNavigationToggle();
}

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

function paintSegmentedMeter(container, count, peak, peakHold = 0) {
  const segments = container.children;
  const litCount = Math.round(Math.min(1, Math.max(0, peak)) * count);
  const holdIndex = peakHold > 0 ? Math.min(count - 1, Math.max(0, Math.round(peakHold * count) - 1)) : -1;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    seg.classList.remove('is-lit-green', 'is-lit-yellow', 'is-lit-red', 'is-peak-hold');
    if (i < litCount) {
      const ratio = i / count;
      if (ratio < 0.6) seg.classList.add('is-lit-green');
      else if (ratio < 0.85) seg.classList.add('is-lit-yellow');
      else seg.classList.add('is-lit-red');
    }
    if (i === holdIndex && i >= litCount) seg.classList.add('is-peak-hold');
  }
}

function updateSegmentedMeter(container, count, peak) {
  paintSegmentedMeter(container, count, peak);
}

function formatDb(value) {
  return value <= -99.5 ? '-inf dB' : `${value.toFixed(1)} dB`;
}

function normalizedToDbForUi(value) {
  return value > 0 ? 20 * Math.log10(Math.min(1, value)) : -100;
}

function smoothToward(current, target, deltaSeconds, attackRate, releaseRate) {
  const rate = target > current ? attackRate : releaseRate;
  const amount = 1 - Math.exp(-rate * deltaSeconds);
  return current + (target - current) * amount;
}

function renderProfessionalVu(now, deltaSeconds) {
  const target = audioVisualState.vuTarget;
  audioVisualState.vuDisplay = audioVisualState.reducedMotion
    ? target
    : smoothToward(audioVisualState.vuDisplay, target, deltaSeconds, 22, 8);

  if (target >= audioVisualState.vuPeakHold) {
    audioVisualState.vuPeakHold = target;
    audioVisualState.vuPeakHoldUntil = now + 1100;
  } else if (now > audioVisualState.vuPeakHoldUntil) {
    audioVisualState.vuPeakHold = smoothToward(audioVisualState.vuPeakHold, target, deltaSeconds, 10, 2.8);
  }

  paintSegmentedMeter(els.vuMeter, VU_SEGMENT_COUNT, audioVisualState.vuDisplay, audioVisualState.vuPeakHold);
  els.vuMeter.style.setProperty('--vu-level', String(audioVisualState.vuDisplay));
  if (els.vuPeakValue) els.vuPeakValue.textContent = formatDb(normalizedToDbForUi(audioVisualState.vuPeakHold));
}

function renderProfessionalSpectrum(now, deltaSeconds) {
  const bars = els.spectrumMeter.children;
  for (let i = 0; i < bars.length; i += 1) {
    const target = audioVisualState.spectrumTarget[i] || 0;
    const current = audioVisualState.spectrumDisplay[i] || 0;
    audioVisualState.spectrumDisplay[i] = audioVisualState.reducedMotion
      ? target
      : smoothToward(current, target, deltaSeconds, 18 + (i / bars.length) * 5, 5.5 + (i / bars.length) * 2.5);

    if (target >= (audioVisualState.spectrumPeak[i] || 0)) {
      audioVisualState.spectrumPeak[i] = target;
      audioVisualState.spectrumPeakUntil[i] = now + 420;
    } else if (now > audioVisualState.spectrumPeakUntil[i]) {
      audioVisualState.spectrumPeak[i] = smoothToward(audioVisualState.spectrumPeak[i], target, deltaSeconds, 8, 3);
    }

    const value = Math.min(1, Math.max(0, audioVisualState.spectrumDisplay[i]));
    const bar = bars[i];
    bar.style.height = `${Math.max(3, value * 54)}px`;
    bar.style.opacity = String(.52 + value * .48);
    bar.style.setProperty('--bar-energy', String(value));
    bar.classList.toggle('is-spectrum-peak', now < audioVisualState.spectrumPeakUntil[i]);
  }
}

function audioVisualFrame(now) {
  if (!audioVisualState.lastFrameAt) audioVisualState.lastFrameAt = now;
  const deltaSeconds = Math.min(.08, Math.max(.001, (now - audioVisualState.lastFrameAt) / 1000));
  audioVisualState.lastFrameAt = now;
  renderProfessionalVu(now, deltaSeconds);
  renderProfessionalSpectrum(now, deltaSeconds);
  audioVisualState.rafId = window.requestAnimationFrame(audioVisualFrame);
}

function startAudioVisualLoop() {
  if (!audioVisualState.rafId) audioVisualState.rafId = window.requestAnimationFrame(audioVisualFrame);
}

// ---------------------------------------------------------------------------
// Ecualizador de espectro: barras de altura variable, una por banda de
// frecuencia (ver computeSpectrum en ffmpeg-stream.js). Se construyen una
// sola vez y solo se les cambia la altura en cada evento.
// ---------------------------------------------------------------------------
function buildSpectrumMeter() {
  els.spectrumMeter.innerHTML = '';
  for (let i = 0; i < SPECTRUM_BAND_COUNT; i += 1) {
    const bar = document.createElement('div');
    bar.className = 'spectrum-bar';
    els.spectrumMeter.appendChild(bar);
  }
}

function updateSpectrumMeter(bands) {
  for (let i = 0; i < SPECTRUM_BAND_COUNT; i += 1) {
    audioVisualState.spectrumTarget[i] = Math.min(1, Math.max(0, Number(bands[i]) || 0));
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

function formatMB(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '--';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  paused: { dotClass: 'is-connecting', text: 'Pausada', sub: 'La conexión sigue activa y se está enviando silencio' },
  reconnecting: { dotClass: 'is-connecting', text: 'Reconectando...', sub: 'Se perdio la conexion, reintentando automaticamente' },
  outro: { dotClass: 'is-connecting', text: 'Reproduciendo Outro', sub: 'La conexion se cerrara 2s antes de que termine' },
  error: { dotClass: 'is-live', text: 'Error de Conexion', sub: 'Revisa el registro de actividad' }
};

function syncBroadcastControls(kind) {
  const terminal = kind === 'idle' || kind === 'error';
  const canPause = kind === 'live' || kind === 'paused';
  if (els.btnStart) els.btnStart.disabled = !terminal;
  if (els.btnStop) els.btnStop.disabled = !(!terminal);
  if (els.btnPause) {
    els.btnPause.disabled = !canPause;
    if (els.btnPauseLabel) els.btnPauseLabel.textContent = kind === 'paused' ? 'Reanudar' : 'Pausar';
    const icon = els.btnPause.querySelector('.icon-inline');
    if (icon) icon.innerHTML = window.renderIcon(kind === 'paused' ? 'play' : 'pause', 15);
  }
}

function setOnAirState(kind, elapsedSeconds) {
  const preset = STATUS_PRESETS[kind] || STATUS_PRESETS.idle;
  syncBroadcastControls(kind);
  els.onairDot.className = `onair-dot ${preset.dotClass}`.trim();
  els.onairStatus.textContent = preset.text;
  els.onairSubstatus.textContent = preset.sub;

  els.statusbarDot.className = `statusbar-dot ${preset.dotClass}`.trim();
  els.statusbarText.textContent = preset.text;
  els.statusBar.classList.toggle('is-live', kind === 'live' || kind === 'error');

  if (els.topbarStatusDot) els.topbarStatusDot.className = `topbar-status-dot ${preset.dotClass}`.trim();
  if (els.topbarStatusText) els.topbarStatusText.textContent = preset.text;
  if (kind === 'idle' || kind === 'error') {
    els.signalQuality.className = 'signal-quality';
    els.signalQuality.textContent = kind === 'error' ? 'REVISAR ACTIVIDAD' : 'SIN SEÑAL';
  }

  els.compactDot.className = `onair-dot ${preset.dotClass}`.trim();
  els.compactStatus.textContent = preset.text;
  els.btnCompactStop.style.visibility = (kind === 'idle' || kind === 'error') ? 'hidden' : 'visible';

  if (kind === 'idle' || kind === 'error') {
    audioVisualState.vuTarget = 0;
    audioVisualState.spectrumTarget.fill(0);
    if (els.vuRmsValue) els.vuRmsValue.textContent = '-inf dB';
    if (els.vuPeakValue) els.vuPeakValue.textContent = '-inf dB';
    if (els.vuStereoValue) els.vuStereoValue.textContent = '-inf / -inf';
    if (els.vuClipIndicator) {
      els.vuClipIndicator.classList.remove('is-clipping');
      els.vuClipIndicator.querySelector('strong').textContent = 'NO';
    }
  }

  if (typeof elapsedSeconds === 'number') {
    els.onairTimer.textContent = formatClock(elapsedSeconds);
    els.statusbarTimer.textContent = formatClock(elapsedSeconds);
    els.compactTimer.textContent = formatClock(elapsedSeconds);
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
    stopTrackPreview();
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
      const previewButton = document.createElement('button');
      previewButton.type = 'button';
      previewButton.className = 'track-picker-option-preview btn-icon-only';
      previewButton.dataset.previewId = track.id;
      previewButton.title = 'Escuchar pista antes de seleccionarla';
      previewButton.setAttribute('aria-label', `Escuchar ${track.name}`);
      previewButton.setAttribute('aria-pressed', 'false');
      previewButton.innerHTML = window.renderIcon('play', 13);
      previewButton.addEventListener('click', (event) => {
        event.stopPropagation();
        window.SoundFX.click();
        toggleTrackPreview(track.id, previewButton);
      });
      opt.appendChild(previewButton);
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
      <button type="button" class="btn-icon-only track-preview-button" data-preview-id="${track.id}" data-preview-state="idle" aria-label="Escuchar ${escapeHtml(track.name)}" aria-pressed="false" title="Escuchar pista">
        ${window.renderIcon('play', 14)}
      </button>
      <div class="track-item-info">
        <span class="track-item-name">${escapeHtml(track.name)}</span>
        <span class="track-item-meta"><span data-preview-time="${track.id}">00:00</span> / ${formatShort(track.durationSeconds)}</span>
        <span class="track-item-progress" aria-hidden="true"><span data-preview-progress="${track.id}"></span></span>
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
  if (typeof renderPodcastClipLibrary === 'function' && activePodcastEpisode()) renderPodcastClipLibrary();
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
  if (previewingTrackId === id) stopTrackPreview();
  window.streamAPI.deleteTrack(id).then((library) => {
    libraryCache = library;
    refreshLibraryUI();
    appendLog('Pista eliminada de la biblioteca.');
  });
}

els.trackList.addEventListener('click', handleLibraryDeleteClick);

// ---------------------------------------------------------------------------
// Vista previa de audio (escuchar una pista antes de elegirla). Un solo
// <audio> compartido: si ya sonaba otra pista, se detiene sola al empezar
// la nueva.
// ---------------------------------------------------------------------------
function setPreviewButtonState(button, state) {
  if (!button) return;
  const isPlaying = state === 'playing';
  const isLoading = state === 'loading';
  const iconName = isPlaying ? 'pause' : 'play';
  const label = isPlaying ? 'Pausar pista' : state === 'paused' ? 'Continuar pista' : 'Escuchar pista';
  button.innerHTML = window.renderIcon(iconName, 14);
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
  button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  button.dataset.previewState = state;
  button.classList.toggle('is-playing', isPlaying);
  button.classList.toggle('is-paused', state === 'paused');
  button.classList.toggle('is-loading', isLoading);
}

function setPreviewButtonsForTrack(trackId, state) {
  if (!trackId) return;
  document.querySelectorAll(`[data-preview-id="${trackId}"]`).forEach((button) => {
    setPreviewButtonState(button, state);
  });
}

function resetPreviewButtons(trackId) {
  if (!trackId) return;
  document.querySelectorAll(`[data-preview-id="${trackId}"]`).forEach((button) => {
    setPreviewButtonState(button, 'idle');
  });
  const progress = document.querySelector(`[data-preview-progress="${trackId}"]`);
  const time = document.querySelector(`[data-preview-time="${trackId}"]`);
  if (progress) progress.style.width = '0%';
  if (time) time.textContent = '00:00';
}

function stopTrackPreview() {
  previewRequestToken += 1;
  const previousTrackId = previewingTrackId;
  previewingTrackId = null;
  previewAudio.pause();
  previewAudio.removeAttribute('src');
  previewAudio.load();
  resetPreviewButtons(previousTrackId);
}

prewireTrackPreviewEndedHandler();
function prewireTrackPreviewEndedHandler() {
  previewAudio.addEventListener('loadedmetadata', () => {
    if (!previewingTrackId) return;
    const track = libraryCache.tracks.find((item) => item.id === previewingTrackId);
    if (track && (!track.durationSeconds || track.durationSeconds <= 0) && Number.isFinite(previewAudio.duration)) {
      track.durationSeconds = previewAudio.duration;
    }
  });
  previewAudio.addEventListener('timeupdate', () => {
    if (!previewingTrackId) return;
    const progress = document.querySelector(`[data-preview-progress="${previewingTrackId}"]`);
    const time = document.querySelector(`[data-preview-time="${previewingTrackId}"]`);
    const duration = Number.isFinite(previewAudio.duration) ? previewAudio.duration : 0;
    if (progress) progress.style.width = duration > 0 ? `${Math.min(100, (previewAudio.currentTime / duration) * 100)}%` : '0%';
    if (time) time.textContent = formatShort(previewAudio.currentTime);
  });
  previewAudio.addEventListener('playing', () => {
    setPreviewButtonsForTrack(previewingTrackId, 'playing');
  });
  previewAudio.addEventListener('pause', () => {
    if (previewingTrackId && !previewAudio.ended) {
      setPreviewButtonsForTrack(previewingTrackId, 'paused');
    }
  });
  previewAudio.addEventListener('waiting', () => {
    setPreviewButtonsForTrack(previewingTrackId, 'loading');
  });
  previewAudio.addEventListener('error', () => {
    const failedId = previewingTrackId;
    stopTrackPreview();
    window.SoundFX.error();
    appendLog(`No se pudo reproducir la pista importada${failedId ? ` (${failedId})` : ''}. Verifica que el archivo sea un formato compatible.`);
  });
  previewAudio.addEventListener('ended', stopTrackPreview);
}

async function toggleTrackPreview(id, btn) {
  if (previewingTrackId === id) {
    if (previewAudio.paused) {
      try {
        await previewAudio.play();
        setPreviewButtonsForTrack(id, 'playing');
      } catch {
        setPreviewButtonsForTrack(id, 'paused');
        appendLog('No se pudo reanudar la preescucha de la pista.');
      }
    } else {
      previewAudio.pause();
      setPreviewButtonsForTrack(id, 'paused');
    }
    return;
  }

  stopTrackPreview();
  const requestToken = previewRequestToken;
  setPreviewButtonState(btn, 'loading');
  const result = await window.streamAPI.getTrackAudio(id);
  if (requestToken !== previewRequestToken) return;
  if (!result || !result.dataUrl) {
    setPreviewButtonState(btn, 'idle');
    window.SoundFX.error();
    appendLog('No se pudo cargar el audio de la pista.');
    return;
  }

  previewAudio.src = result.dataUrl;
  previewAudio.load();
  previewingTrackId = id;
  try {
    await previewAudio.play();
    if (requestToken === previewRequestToken && previewingTrackId === id) {
      setPreviewButtonsForTrack(id, 'playing');
    }
  } catch {
    if (requestToken !== previewRequestToken) return;
    setPreviewButtonsForTrack(id, 'idle');
    previewingTrackId = null;
    appendLog('El navegador no pudo iniciar la preescucha de la pista.');
  }
}

els.trackList.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-preview-id]');
  if (!btn) return;
  window.SoundFX.click();
  toggleTrackPreview(btn.getAttribute('data-preview-id'), btn);
});

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
  els.aboutVersion.textContent = `Versión ${info.version}`;
}

// ---------------------------------------------------------------------------
// Actualizaciones: estados visibles, progreso y reinicio para instalar.
// ---------------------------------------------------------------------------
function updateStatePill(state, label) {
  if (!els.updateStatePill) return;
  els.updateStatePill.className = 'update-state-pill';
  if (state === 'downloading' || state === 'available' || state === 'checking') els.updateStatePill.classList.add('is-downloading');
  if (state === 'downloaded') els.updateStatePill.classList.add('is-ready');
  if (state === 'error') els.updateStatePill.classList.add('is-error');
  els.updateStatePill.textContent = label;
}

function showUpdateBadge(title) {
  els.activityUpdateBadge.hidden = false;
  els.activityUpdateBadge.title = title;
}

function setUpdateDownloadMeta(payload) {
  const transferred = formatMB(payload.transferred);
  const total = formatMB(payload.total);
  const speed = payload.bytesPerSecond ? `${formatMB(payload.bytesPerSecond)}/s` : 'calculando velocidad';
  els.updateProgressMeta.textContent = `${transferred} de ${total} · ${speed}`;
}

function openUpdateModal() {
  if (!latestUpdateInfo) return;
  if (latestUpdateInfo.state === 'downloaded') {
    showModal({
      title: 'Actualización lista',
      message: `La versión v${latestUpdateInfo.version} ya se descargó. Puedes reiniciar ahora para instalarla o hacerlo más tarde.`,
      actions: [
        { label: 'Más tarde', className: 'btn-secondary' },
        { label: 'Reiniciar para instalar', className: 'btn-primary', onClick: () => window.streamAPI.restartToUpdate() }
      ]
    });
  } else {
    showModal({
      title: 'Descargando actualización',
      message: `La versión v${latestUpdateInfo.version} se está descargando en segundo plano. Puedes continuar trabajando; aparecerá una acción de reinicio cuando esté lista para instalar.`,
      actions: [{ label: 'Entendido', className: 'btn-primary' }]
    });
  }
}

els.btnCheckUpdates.addEventListener('click', async () => {
  window.SoundFX.click();
  els.btnCheckUpdates.disabled = true;
  updateStatePill('checking', 'COMPROBANDO');
  els.updateStatus.textContent = 'Buscando una versión nueva en GitHub…';
  await window.streamAPI.checkForUpdates();
  els.btnCheckUpdates.disabled = false;
});

els.btnRestartUpdate.addEventListener('click', () => {
  window.SoundFX.start();
  window.streamAPI.restartToUpdate();
});

function handleUpdateState(payload) {
  if (!payload || !payload.state) return;
  if (payload.state === 'checking') {
    latestUpdateInfo = payload;
    updateStatePill('checking', 'COMPROBANDO');
    els.updateStatus.textContent = 'Comprobando actualizaciones…';
    els.updateProgress.hidden = false;
    els.updateProgressFill.style.width = '0%';
    els.updateProgressLabel.textContent = '0%';
    els.updateProgressMeta.textContent = 'Consultando GitHub…';
    els.btnRestartUpdate.hidden = true;
  } else if (payload.state === 'available') {
    latestUpdateInfo = payload;
    updateStatePill('available', 'DESCARGANDO');
    els.updateStatus.textContent = `Nueva versión v${payload.version} encontrada. Iniciando descarga…`;
    els.updateProgress.hidden = false;
    els.updateProgressFill.style.width = '0%';
    els.updateProgressLabel.textContent = '0%';
    els.updateProgressMeta.textContent = 'Preparando descarga…';
    els.btnRestartUpdate.hidden = true;
    showUpdateBadge(`Descargando actualización v${payload.version}`);
  } else if (payload.state === 'downloading') {
    latestUpdateInfo = payload;
    const pct = Math.min(100, Math.max(0, Math.round(payload.percent || 0)));
    updateStatePill('downloading', `DESCARGANDO ${pct}%`);
    els.updateProgress.hidden = false;
    els.updateProgressFill.style.width = `${pct}%`;
    els.updateProgressLabel.textContent = `${pct}%`;
    els.updateStatus.textContent = `Descargando actualización… ${pct}%`;
    setUpdateDownloadMeta(payload);
    els.btnRestartUpdate.hidden = true;
    showUpdateBadge(`Descargando actualización… ${pct}%`);
  } else if (payload.state === 'downloaded') {
    latestUpdateInfo = payload;
    updateStatePill('downloaded', 'LISTA PARA INSTALAR');
    // Mantener la barra visible al 100%: el usuario debe ver que la descarga
    // terminó, no solo recibir el mensaje final de "descargado".
    els.updateProgress.hidden = false;
    els.updateProgressFill.style.width = '100%';
    els.updateProgressLabel.textContent = '100%';
    els.updateProgressMeta.textContent = 'Descarga completada · lista para instalar';
    els.updateStatus.textContent = `La versión v${payload.version} está lista. Reinicia la aplicación para instalarla.`;
    els.btnRestartUpdate.hidden = false;
    showUpdateBadge('Actualización lista · Reiniciar para instalar');
    openUpdateModal();
  } else if (payload.state === 'not-available') {
    latestUpdateInfo = null;
    updateStatePill('not-available', 'AL DÍA');
    els.updateProgress.hidden = true;
    els.updateStatus.textContent = 'Ya tienes instalada la versión más reciente.';
    els.btnRestartUpdate.hidden = true;
    els.activityUpdateBadge.hidden = true;
  } else if (payload.state === 'error') {
    latestUpdateInfo = payload;
    updateStatePill('error', 'ERROR');
    els.updateProgress.hidden = true;
    els.updateStatus.textContent = 'No se pudo comprobar la actualización. Revisa la conexión e inténtalo de nuevo.';
    els.btnRestartUpdate.hidden = true;
  }
}

window.streamAPI.onUpdateState(handleUpdateState);

els.activityUpdateBadge.addEventListener('click', () => {
  window.SoundFX.click();
  if (latestUpdateInfo) openUpdateModal();
  else switchView('about');
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
// Proveedores y configuracion persistida.
// ---------------------------------------------------------------------------
function selectedProviderMeta() {
  return providerCatalog.find((provider) => provider.id === els.providerSelect.value) || providerCatalog[0];
}

function populateProviderOptions() {
  if (!els.providerSelect) return;
  const selected = els.providerSelect.value || 'zeno-icecast';
  els.providerSelect.innerHTML = '';
  providerCatalog.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    els.providerSelect.appendChild(option);
  });
  els.providerSelect.value = providerCatalog.some((provider) => provider.id === selected) ? selected : providerCatalog[0].id;
}

function setFieldValidity(element, state) {
  if (!element) return;
  element.classList.toggle('input-valid', state === 'valid');
  element.classList.toggle('input-invalid', state === 'invalid');
}

function validateConnectionFields({ announce = true } = {}) {
  const provider = selectedProviderMeta();
  const errors = [];
  const server = els.servidor.value.trim();
  const port = Number(els.puerto.value.trim());
  const mount = els.punto.value.trim();
  const user = els.usuario.value.trim();
  const password = els.password.value;
  const streamId = els.streamId.value.trim();
  const hostOk = Boolean(server);
  const portOk = Number.isInteger(port) && port >= 1 && port <= 65535;
  const mountOk = !provider.requiresMount || Boolean(mount);
  const userOk = !provider.requiresUser || Boolean(user);
  const passwordOk = Boolean(password.trim());
  const streamIdOk = provider.protocol !== 'shoutcast' || !streamId || /^\d+$/.test(streamId);

  if (!hostOk) errors.push('servidor');
  if (!portOk) errors.push('puerto');
  if (!mountOk) errors.push('mountpoint');
  if (provider.requiresUser && !userOk) errors.push('usuario');
  if (!passwordOk) errors.push('contraseña');
  if (!streamIdOk) errors.push('Stream ID');

  setFieldValidity(els.servidor, hostOk ? 'valid' : 'invalid');
  setFieldValidity(els.puerto, portOk ? 'valid' : 'invalid');
  setFieldValidity(els.punto, mountOk ? 'valid' : 'invalid');
  setFieldValidity(els.usuario, userOk ? 'valid' : 'invalid');
  setFieldValidity(els.password, passwordOk ? 'valid' : 'invalid');
  setFieldValidity(els.streamId, streamIdOk ? (streamId ? 'valid' : null) : 'invalid');

  const valid = errors.length === 0;
  if (announce && els.providerValidation) {
    els.providerValidation.classList.toggle('is-valid', valid);
    els.providerValidation.classList.toggle('is-invalid', !valid);
    els.providerValidationText.textContent = valid
      ? `Configuración lista para ${provider.label}.`
      : `Falta revisar: ${errors.join(', ')}.`;
  }
  return { ok: valid, errors, provider };
}

function updateProviderUi() {
  const provider = selectedProviderMeta();
  const previous = providerCatalog.find((item) => item.id === lastProviderId);
  const shoutcast = provider.protocol === 'shoutcast';
  els.providerProtocolPill.textContent = provider.protocol.toUpperCase();
  els.providerHelp.textContent = provider.help;
  els.servidor.placeholder = provider.serverPlaceholder;
  els.punto.placeholder = provider.mountPlaceholder;
  els.puerto.placeholder = provider.defaultPort;
  els.usuario.placeholder = provider.defaultUser;
  els.labelPunto.textContent = shoutcast ? 'Punto de montaje (opcional)' : 'Punto de montaje (mountpoint)';
  els.labelUsuario.textContent = provider.requiresUser ? 'Nombre de usuario' : 'Nombre de usuario (opcional)';
  els.fieldMount.hidden = shoutcast;
  els.fieldStreamId.hidden = !shoutcast;
  if (!els.puerto.value || els.puerto.value === previous?.defaultPort) els.puerto.value = provider.defaultPort;
  if (!els.usuario.value || els.usuario.value === previous?.defaultUser) els.usuario.value = provider.defaultUser;
  lastProviderId = provider.id;
  validateConnectionFields();
}

async function copyFieldValue(input) {
  if (!input) return;
  const value = input.value || '';
  if (!value) {
    appendLog('No hay ningún valor para copiar.');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    appendLog('Valor copiado al portapapeles.');
  } catch {
    input.focus();
    input.select();
    document.execCommand('copy');
    appendLog('Valor copiado al portapapeles.');
  }
}

document.querySelectorAll('[data-copy-target]').forEach((button) => {
  button.addEventListener('click', () => {
    window.SoundFX.click();
    copyFieldValue(document.getElementById(button.dataset.copyTarget));
  });
});

els.togglePassword.addEventListener('click', () => {
  const showing = els.password.type === 'text';
  els.password.type = showing ? 'password' : 'text';
  els.togglePassword.textContent = showing ? 'Mostrar' : 'Ocultar';
  els.togglePassword.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
});

els.providerSelect.addEventListener('change', () => {
  window.SoundFX.click();
  updateProviderUi();
  persistSettings();
});

function currentConfig() {
  return {
    provider: els.providerSelect.value || 'zeno-icecast',
    server: els.servidor.value.trim(),
    port: els.puerto.value.trim(),
    mount: els.punto.value.trim(),
    streamId: els.streamId.value.trim(),
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
  els.providerSelect.value = settings.provider || 'zeno-icecast';
  els.servidor.value = settings.server ?? '';
  els.puerto.value = settings.port ?? '';
  els.punto.value = settings.mount ?? '';
  els.streamId.value = settings.streamId ?? '';
  els.usuario.value = settings.user ?? '';
  els.password.value = settings.password ?? '';
  updateProviderUi();
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
  els.servidor, els.puerto, els.punto, els.streamId, els.usuario, els.password, els.device
].forEach((el) => {
  el.addEventListener('input', () => validateConnectionFields());
  el.addEventListener('change', () => {
    validateConnectionFields();
    persistSettings();
  });
});
els.checkIntro.addEventListener('change', () => persistSettings());
els.checkOutro.addEventListener('change', () => persistSettings());

// ---------------------------------------------------------------------------
// Programacion automatica (inicio/fin de transmision por horario). Usa la
// MISMA configuracion de arriba (currentConfig/settings-store), solo agrega
// cuando debe dispararse sola y si debe grabar automaticamente.
// ---------------------------------------------------------------------------
const DAY_OPTIONS = [
  { key: 'mon', label: 'Lun' },
  { key: 'tue', label: 'Mar' },
  { key: 'wed', label: 'Mie' },
  { key: 'thu', label: 'Jue' },
  { key: 'fri', label: 'Vie' },
  { key: 'sat', label: 'Sab' },
  { key: 'sun', label: 'Dom' }
];

let selectedDays = ['mon', 'tue', 'wed', 'thu', 'fri'];

function buildDayPicker() {
  els.dayPicker.innerHTML = '';
  DAY_OPTIONS.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-toggle';
    btn.textContent = label;
    btn.dataset.day = key;
    btn.addEventListener('click', () => {
      window.SoundFX.click();
      if (selectedDays.includes(key)) {
        selectedDays = selectedDays.filter((d) => d !== key);
      } else {
        selectedDays.push(key);
      }
      renderDayPicker();
      persistSchedule();
    });
    els.dayPicker.appendChild(btn);
  });
  renderDayPicker();
}

function renderDayPicker() {
  Array.from(els.dayPicker.children).forEach((btn) => {
    btn.classList.toggle('is-active', selectedDays.includes(btn.dataset.day));
  });
}

function persistSchedule() {
  window.streamAPI.saveSchedule({
    enabled: els.checkScheduleEnabled.checked,
    startTime: els.scheduleStart.value || '07:00',
    stopTime: els.scheduleStop.value || '09:00',
    days: selectedDays,
    autoRecord: els.checkScheduleRecord.checked
  });
}

function applySchedule(schedule) {
  if (!schedule) return;
  els.checkScheduleEnabled.checked = Boolean(schedule.enabled);
  els.scheduleStart.value = schedule.startTime || '07:00';
  els.scheduleStop.value = schedule.stopTime || '09:00';
  selectedDays = Array.isArray(schedule.days) && schedule.days.length > 0
    ? schedule.days
    : ['mon', 'tue', 'wed', 'thu', 'fri'];
  els.checkScheduleRecord.checked = Boolean(schedule.autoRecord);
  renderDayPicker();
}

[
  els.checkScheduleEnabled, els.scheduleStart, els.scheduleStop, els.checkScheduleRecord
].forEach((el) => el.addEventListener('change', () => persistSchedule()));

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
  const validation = validateConnectionFields();

  if (!validation.ok) {
    window.SoundFX.error();
    appendLog(`Revisa la configuración de ${validation.provider.label}: ${validation.errors.join(', ')}.`);
    return;
  }

  showModal({
    title: 'Grabar esta transmisión',
    message: `¿Quieres guardar también un archivo local (mp3) de esta transmisión, además de enviarla a ${validation.provider.label}? Se guarda en tu carpeta de Documentos.`,
    dismissible: false,
    actions: [
      { label: 'No, solo transmitir', className: 'btn-secondary', onClick: () => actuallyStartStream(config, false) },
      { label: 'Si, grabar', className: 'btn-primary', onClick: () => actuallyStartStream(config, true) }
    ]
  });
});

els.btnPause.addEventListener('click', async () => {
  window.SoundFX.click();
  els.btnPause.disabled = true;
  const result = await window.streamAPI.togglePause();
  if (!result || !result.ok) {
    window.SoundFX.error();
    setOnAirState('live');
    appendLog('No se pudo cambiar el estado de pausa de la transmisión.');
    return;
  }
  setOnAirState(result.paused ? 'paused' : 'live');
});

els.btnStop.addEventListener('click', async () => {
  window.SoundFX.stop();
  els.btnStop.disabled = true;
  if (els.btnPause) els.btnPause.disabled = true;
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
    els.deadAirBanner.hidden = true;
    // Si la vista de Historial esta visible, refrescarla para que la
    // sesion recien terminada aparezca de inmediato.
    const historyView = document.querySelector('[data-view-panel="history"]');
    if (historyView && historyView.classList.contains('view-active')) {
      loadHistory();
    }
  }
});

window.streamAPI.onVuLevel((payload) => {
  // payload: { peak, db, rmsDb, leftDb, rightDb, clip }.
  const peak = Math.min(1, Math.max(0, Number(payload.peak) || 0));
  audioVisualState.vuTarget = peak;
  els.vuMeter.setAttribute('aria-valuenow', String(payload.db));
  els.vuDbValue.textContent = formatDb(Number(payload.db));
  if (els.vuRmsValue) els.vuRmsValue.textContent = formatDb(Number(payload.rmsDb));
  if (els.vuStereoValue) els.vuStereoValue.textContent = `${formatDb(Number(payload.leftDb)).replace(' dB', '')} / ${formatDb(Number(payload.rightDb)).replace(' dB', '')}`;
  if (els.vuClipIndicator) {
    els.vuClipIndicator.classList.toggle('is-clipping', Boolean(payload.clip));
    els.vuClipIndicator.querySelector('strong').textContent = payload.clip ? 'SÍ' : 'NO';
  }

  const quality = payload.clip || peak >= 0.94
    ? { text: 'SATURANDO', className: 'is-clip' }
    : peak >= 0.12
      ? { text: 'SEÑAL ESTABLE', className: 'is-good' }
      : peak > 0.002
        ? { text: 'SEÑAL BAJA', className: 'is-low' }
        : { text: 'SIN SEÑAL', className: '' };
  els.signalQuality.className = `signal-quality ${quality.className}`.trim();
  els.signalQuality.textContent = quality.text;
});

window.streamAPI.onSpectrum((payload) => {
  updateSpectrumMeter(payload.bands || []);
});

window.streamAPI.onPreviewVuLevel((payload) => {
  updateSegmentedMeter(els.micTestMeter, MIC_TEST_SEGMENT_COUNT, payload.peak);
  els.micTestDb.textContent = payload.db <= -100 ? '-inf dB' : `${payload.db.toFixed(1)} dB`;
});

window.streamAPI.onDeadAir((payload) => {
  els.deadAirBanner.hidden = !payload.active;
  if (payload.active) window.SoundFX.error();
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
// Podcast Studio
// ---------------------------------------------------------------------------
let podcastEpisodes = [];
let activeEpisodeId = null;
let podcastExportActive = false;
let draggedTimelineIndex = null;
const podcastPreviewAudio = new Audio();
const podcastPreviewState = { index: null, start: 0, end: 0, baseVolume: 1, fadeIn: 0, fadeOut: 0, automation: [] };
const podcastRecordingUi = {
  recording: false,
  startedAt: 0,
  timerId: null,
  outputPath: null,
  level: 0
};

function makeClientId() {
  return window.crypto?.randomUUID?.() || `segment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activePodcastEpisode() {
  return podcastEpisodes.find((episode) => episode.id === activeEpisodeId) || null;
}

function resetPodcastPreviewButton(index) {
  const button = els.podcastTimeline.querySelector(`[data-preview-segment="${index}"]`);
  if (button) button.innerHTML = window.renderIcon('play', 13);
}

function stopPodcastSegmentPreview() {
  podcastPreviewAudio.pause();
  podcastPreviewAudio.removeAttribute('src');
  podcastPreviewAudio.load();
  if (podcastPreviewState.index !== null) resetPodcastPreviewButton(podcastPreviewState.index);
  podcastPreviewState.index = null;
  podcastPreviewAudio.volume = 1;
}

function getEnvelopeGain(points, time, fallback) {
  if (!Array.isArray(points) || points.length === 0) return fallback;
  const sorted = [...points].sort((a, b) => Number(a.time) - Number(b.time));
  if (time <= Number(sorted[0].time)) return Number(sorted[0].gain);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const next = sorted[i];
    const previousTime = Number(previous.time);
    const nextTime = Number(next.time);
    if (time <= nextTime) {
      const span = Math.max(.001, nextTime - previousTime);
      const ratio = Math.min(1, Math.max(0, (time - previousTime) / span));
      return Number(previous.gain) + (Number(next.gain) - Number(previous.gain)) * ratio;
    }
  }
  return Number(sorted[sorted.length - 1].gain);
}

function applyPodcastPreviewMix() {
  const elapsed = podcastPreviewAudio.currentTime - podcastPreviewState.start;
  const remaining = podcastPreviewState.end - podcastPreviewAudio.currentTime;
  let gain = getEnvelopeGain(podcastPreviewState.automation, elapsed, podcastPreviewState.baseVolume);
  if (podcastPreviewState.fadeIn > 0) gain *= Math.min(1, Math.max(0, elapsed / podcastPreviewState.fadeIn));
  if (podcastPreviewState.fadeOut > 0) gain *= Math.min(1, Math.max(0, remaining / podcastPreviewState.fadeOut));
  podcastPreviewAudio.volume = Math.min(1, Math.max(0, gain));
}

async function togglePodcastSegmentPreview(index, button) {
  const episode = activePodcastEpisode();
  const segment = episode?.segments?.[index];
  if (!segment) return;
  if (podcastPreviewState.index === index && !podcastPreviewAudio.paused) {
    stopPodcastSegmentPreview();
    return;
  }
  stopPodcastSegmentPreview();
  const result = await window.streamAPI.getPodcastSegmentAudio(segment);
  if (!result?.ok || !result.dataUrl) {
    appendLog('No se pudo cargar el audio del segmento.');
    window.SoundFX.error();
    return;
  }
  const duration = Math.max(0.1, Number(segment.durationSeconds) || 0.1);
  const start = Math.max(0, Number(segment.trimStart) || 0);
  const end = Math.min(duration, Number(segment.trimEnd) > start ? Number(segment.trimEnd) : duration);
  podcastPreviewState.index = index;
  podcastPreviewState.start = start;
  podcastPreviewState.end = end;
  const segmentVolume = Number.isFinite(Number(segment.volume)) ? Number(segment.volume) : 1;
  podcastPreviewState.baseVolume = Math.min(1, Math.max(0, segmentVolume));
  podcastPreviewState.fadeIn = Math.max(0, Number(segment.fadeIn) || 0);
  podcastPreviewState.fadeOut = Math.max(0, Number(segment.fadeOut) || 0);
  podcastPreviewState.automation = Array.isArray(segment.automation) ? segment.automation : [];
  podcastPreviewAudio.src = result.dataUrl;
  const startPlayback = async () => {
    if (podcastPreviewState.index !== index) return;
    podcastPreviewAudio.currentTime = Math.min(start, Math.max(0, podcastPreviewAudio.duration - 0.01));
    applyPodcastPreviewMix();
    button.innerHTML = window.renderIcon('stop', 13);
    try { await podcastPreviewAudio.play(); } catch { stopPodcastSegmentPreview(); }
  };
  if (podcastPreviewAudio.readyState >= 1) startPlayback();
  else podcastPreviewAudio.addEventListener('loadedmetadata', startPlayback, { once: true });
}

podcastPreviewAudio.addEventListener('timeupdate', () => {
  if (podcastPreviewState.index === null) return;
  applyPodcastPreviewMix();
  if (podcastPreviewAudio.currentTime >= podcastPreviewState.end - 0.03) stopPodcastSegmentPreview();
});
podcastPreviewAudio.addEventListener('ended', stopPodcastSegmentPreview);

function resetPodcastRecordingMeter() {
  if (!els.recordingMeter) return;
  paintSegmentedMeter(els.recordingMeter, 20, 0);
  els.recordingMeter.style.setProperty('--vu-level', '0');
  els.recordingDb.textContent = '-inf dB';
  els.recordingRms.textContent = 'RMS -inf dB';
}

function setPodcastRecordingUi(state, details = {}) {
  const isRecording = state === 'recording';
  const isProcessing = state === 'stopping' || state === 'saving';
  podcastRecordingUi.recording = isRecording;
  if (isRecording && !podcastRecordingUi.startedAt) podcastRecordingUi.startedAt = Date.now() - (Number(details.elapsedSeconds) || 0) * 1000;
  if (!isRecording) {
    clearInterval(podcastRecordingUi.timerId);
    podcastRecordingUi.timerId = null;
    podcastRecordingUi.startedAt = 0;
  }

  els.recordVoiceButton.disabled = isProcessing;
  els.recordVoiceButton.classList.toggle('is-recording', isRecording);
  els.recordingStatePill.className = 'recording-state-pill';
  if (isRecording) els.recordingStatePill.classList.add('is-recording');
  if (isProcessing) els.recordingStatePill.classList.add('is-processing');
  els.recordingStatePill.textContent = isRecording ? 'GRABANDO' : isProcessing ? 'GUARDANDO' : state === 'error' ? 'ERROR' : 'LISTO';
  els.recordButtonLabel.textContent = isRecording ? 'Detener toma' : isProcessing ? 'Procesando…' : 'Grabar voz';

  if (isRecording) {
    els.recordingHelp.className = 'recording-help';
    els.recordingHelp.textContent = 'Habla con normalidad. La captura se está guardando localmente y no sale por la transmisión.';
    if (!podcastRecordingUi.timerId) podcastRecordingUi.timerId = setInterval(() => {
      els.recordingTimer.textContent = formatShort((Date.now() - podcastRecordingUi.startedAt) / 1000);
    }, 250);
  } else if (state === 'error') {
    els.recordingHelp.className = 'recording-help is-error';
    els.recordingHelp.textContent = details.message || 'No se pudo iniciar la grabación. Revisa el dispositivo de entrada.';
  } else if (state === 'stopped') {
    els.recordingHelp.className = 'recording-help is-success';
    els.recordingHelp.textContent = details.message || 'Toma guardada. Se añadió al final del episodio.';
  } else {
    els.recordingHelp.className = 'recording-help';
    els.recordingHelp.textContent = 'Selecciona un dispositivo de entrada en Configuración antes de grabar.';
  }
  if (!isRecording) els.recordingTimer.textContent = details.durationSeconds ? formatShort(details.durationSeconds) : '00:00';
}

function updatePodcastRecordingLevel(payload) {
  const peak = Math.min(1, Math.max(0, Number(payload.peak) || 0));
  podcastRecordingUi.level = peak;
  paintSegmentedMeter(els.recordingMeter, 20, peak);
  els.recordingMeter.style.setProperty('--vu-level', String(peak));
  els.recordingDb.textContent = formatDb(Number(payload.db));
  els.recordingRms.textContent = `RMS ${formatDb(Number(payload.rmsDb))}`;
}

async function addRecordingToActiveEpisode(result) {
  const episode = activePodcastEpisode();
  if (!episode || !result?.outputPath || !(Number(result.durationSeconds) > 0)) return false;
  episode.segments.push({
    id: makeClientId(),
    type: 'recording',
    sourceId: result.outputPath,
    name: `Voz · ${new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`,
    durationSeconds: Number(result.durationSeconds),
    trimStart: 0,
    trimEnd: Number(result.durationSeconds)
  });
  await saveActivePodcastEpisode({ silent: true });
  return true;
}

async function togglePodcastVoiceRecording() {
  const episode = activePodcastEpisode();
  if (!episode) {
    els.recordingHelp.className = 'recording-help is-error';
    els.recordingHelp.textContent = 'Crea o selecciona un episodio antes de grabar.';
    return;
  }
  window.SoundFX.click();
  if (podcastRecordingUi.recording) {
    setPodcastRecordingUi('stopping');
    const result = await window.streamAPI.stopPodcastRecording();
    if (result?.ok) {
      await addRecordingToActiveEpisode(result);
      setPodcastRecordingUi('stopped', { durationSeconds: result.durationSeconds, message: 'Toma guardada y añadida al final del episodio.' });
      window.SoundFX.success();
    } else {
      setPodcastRecordingUi('error', { message: result?.message || 'No se pudo guardar la toma.' });
      window.SoundFX.error();
    }
    return;
  }

  resetPodcastRecordingMeter();
  const result = await window.streamAPI.startPodcastRecording(els.device.value || null);
  if (!result?.ok) {
    setPodcastRecordingUi('error', { message: result?.message || 'No se pudo iniciar la grabación. Comprueba naudiodon y el dispositivo de entrada.' });
    window.SoundFX.error();
  }
}

function updatePodcastEpisodes(episode) {
  if (!episode) return;
  const index = podcastEpisodes.findIndex((item) => item.id === episode.id);
  if (index === -1) podcastEpisodes.unshift(episode);
  else podcastEpisodes[index] = episode;
  podcastEpisodes.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function podcastEpisodeDuration(episode) {
  let cursor = 0;
  return (episode?.segments || []).reduce((total, segment) => {
    const duration = Math.max(0, Number(segment.durationSeconds) || 0);
    const trimStart = Math.max(0, Number(segment.trimStart) || 0);
    const trimEnd = Number(segment.trimEnd) > trimStart ? Number(segment.trimEnd) : duration;
    const clipDuration = Math.max(0, trimEnd - trimStart);
    const startTime = Number.isFinite(Number(segment.startTime)) ? Math.max(0, Number(segment.startTime)) : cursor;
    cursor = Math.max(cursor, startTime + clipDuration);
    return Math.max(total, startTime + clipDuration);
  }, 0);
}

function renderEpisodeList() {
  els.episodeCount.textContent = String(podcastEpisodes.length);
  els.episodeList.innerHTML = '';
  if (podcastEpisodes.length === 0) {
    els.episodeList.innerHTML = '<p class="track-list-empty">Todavía no hay episodios.</p>';
    return;
  }

  podcastEpisodes.forEach((episode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `episode-list-item${episode.id === activeEpisodeId ? ' is-active' : ''}`;
    button.dataset.episodeId = episode.id;
    button.innerHTML = `
      <span class="episode-list-index">${String(podcastEpisodes.indexOf(episode) + 1).padStart(2, '0')}</span>
      <span class="episode-list-copy"><strong>${escapeHtml(episode.title)}</strong><small>${episode.segments.length} clip${episode.segments.length === 1 ? '' : 's'} · ${formatShort(podcastEpisodeDuration(episode))}</small></span>
      <span class="episode-list-status">${episode.status === 'exported' ? 'MP3' : 'BORRADOR'}</span>
    `;
    els.episodeList.appendChild(button);
  });
}

function renderAutomationControls(segment, index, clipDuration) {
  const baseVolume = Number.isFinite(Number(segment.volume)) ? Number(segment.volume) : 1;
  const points = Array.isArray(segment.automation) && segment.automation.length > 0
    ? segment.automation
    : [{ time: 0, gain: baseVolume }, { time: clipDuration / 2, gain: baseVolume }, { time: clipDuration, gain: baseVolume }];
  const pointMarkup = points.map((point, pointIndex) => {
    const time = Math.min(clipDuration, Math.max(0, Number(point.time) || 0));
    const gain = Math.min(2, Math.max(0, Number(point.gain) || 0));
    return `<div class="automation-point"><span class="automation-point-label">P${pointIndex + 1}</span><input type="number" min="0" max="${Math.max(.1, clipDuration)}" step="0.1" value="${time.toFixed(1)}" data-envelope-time="${index}:${pointIndex}" aria-label="Tiempo del punto ${pointIndex + 1}" /><input type="range" min="0" max="2" step="0.05" value="${gain}" data-envelope-gain="${index}:${pointIndex}" aria-label="Ganancia del punto ${pointIndex + 1}" /><output data-envelope-output="${index}:${pointIndex}">${Math.round(gain * 100)}%</output>${points.length > 2 ? `<button type="button" class="automation-remove" data-remove-envelope="${index}:${pointIndex}" title="Eliminar punto">×</button>` : ''}</div>`;
  }).join('');
  return `<div class="timeline-automation" data-automation-index="${index}"><div class="automation-header"><span>ENVOLVENTE DE VOLUMEN</span><span class="automation-summary" data-envelope-summary="${index}">${points.length} PUNTOS</span></div><div class="automation-points">${pointMarkup}</div><button type="button" class="automation-add" data-add-envelope="${index}"${points.length >= 6 ? ' disabled' : ''}>+ Añadir punto</button></div>`;
}

function renderPodcastTimeline() {
  const episode = activePodcastEpisode();
  if (!episode) return;
  stopPodcastSegmentPreview();
  const segments = episode.segments || [];
  let timelineCursor = 0;
  els.timelineDuration.textContent = formatShort(podcastEpisodeDuration(episode));
  els.podcastTimeline.innerHTML = '';
  if (segments.length === 0) {
    els.podcastTimeline.innerHTML = '<div class="timeline-empty">Añade clips desde la biblioteca para comenzar.</div>';
    return;
  }

  segments.forEach((segment, index) => {
    const track = libraryCache.tracks.find((item) => item.id === segment.sourceId);
    const item = document.createElement('div');
    item.className = 'timeline-clip';
    item.draggable = true;
    item.dataset.timelineIndex = String(index);
    const duration = Math.max(0, Number(segment.durationSeconds) || 0);
    const maxDuration = Math.max(1, duration);
    const start = Math.min(maxDuration, Math.max(0, Number(segment.trimStart) || 0));
    const end = Math.min(maxDuration, Number(segment.trimEnd) > start ? Number(segment.trimEnd) : maxDuration);
    const clipDuration = Math.max(0, end - start);
    const startTime = Number.isFinite(Number(segment.startTime)) ? Math.max(0, Number(segment.startTime)) : timelineCursor;
    timelineCursor = Math.max(timelineCursor, startTime + clipDuration);
    const title = track?.name || segment.name || 'Clip no disponible';
    item.innerHTML = `
      <div class="timeline-clip-head"><span class="timeline-clip-grip" title="Arrastrar para reordenar">⋮⋮</span><span class="timeline-clip-index">${String(index + 1).padStart(2, '0')}</span><span class="timeline-clip-info"><strong>${escapeHtml(title)}</strong><small>${formatShort(clipDuration)} · ${segment.type === 'recording' ? 'Grabación de voz' : 'Biblioteca'}</small></span><span class="timeline-clip-actions"><button type="button" class="timeline-preview" data-preview-segment="${index}" title="Previsualizar clip">${window.renderIcon('play', 13)}</button><button type="button" data-move-up="${index}" title="Subir clip"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" data-move-down="${index}" title="Bajar clip"${index === segments.length - 1 ? ' disabled' : ''}>↓</button><button type="button" class="timeline-remove" data-remove-clip="${index}" title="Quitar clip">×</button></span></div>
      <div class="timeline-waveform" data-waveform-id="${escapeHtml(segment.id)}"><span class="waveform-placeholder">Generando forma de onda…</span></div>
      <details class="timeline-clip-advanced">
        <summary><span>Ajustes del clip</span><small>Recorte · posición · mezcla · fades</small><span class="advanced-chevron">⌄</span></summary>
        <div class="timeline-trim-controls"><label>IN <input type="range" min="0" max="${maxDuration}" step="0.1" value="${start}" data-trim-start="${index}" aria-label="Inicio de ${escapeHtml(title)}" /></label><label>OUT <input type="range" min="0" max="${maxDuration}" step="0.1" value="${end}" data-trim-end="${index}" aria-label="Final de ${escapeHtml(title)}" /></label><span class="timeline-trim-summary" data-trim-summary="${index}">${formatShort(start)} — ${formatShort(end)}</span></div>
        <div class="timeline-mix-controls"><label class="timeline-position-picker">POS <input type="number" min="0" max="86400" step="0.1" value="${startTime.toFixed(1)}" data-start-index="${index}" aria-label="Posición de ${escapeHtml(title)}" /></label><label class="timeline-track-picker">PISTA <select data-track-index="${index}" aria-label="Pista de ${escapeHtml(title)}"><option value="voice"${segment.track === 'voice' ? ' selected' : ''}>Voz</option><option value="music"${segment.track === 'music' ? ' selected' : ''}>Música</option><option value="identity"${segment.track === 'identity' ? ' selected' : ''}>Identidad</option></select></label><label>VOL <input type="range" min="0" max="2" step="0.05" value="${Number.isFinite(Number(segment.volume)) ? Number(segment.volume) : 1}" data-volume-index="${index}" aria-label="Volumen de ${escapeHtml(title)}" /><output data-volume-output="${index}">${Math.round((Number.isFinite(Number(segment.volume)) ? Number(segment.volume) : 1) * 100)}%</output></label><label>FADE IN <input type="number" min="0" max="30" step="0.1" value="${Number(segment.fadeIn) || 0}" data-fade-in-index="${index}" /></label><label>FADE OUT <input type="number" min="0" max="30" step="0.1" value="${Number(segment.fadeOut) || 0}" data-fade-out-index="${index}" /></label></div>
        ${renderAutomationControls(segment, index, clipDuration)}
      </details>
    `;
    els.podcastTimeline.appendChild(item);
  });
  hydrateTimelineWaveforms();
}

async function hydrateTimelineWaveforms() {
  const episode = activePodcastEpisode();
  if (!episode) return;
  for (const segment of episode.segments || []) {
    const waveform = Array.from(els.podcastTimeline.querySelectorAll('[data-waveform-id]')).find((item) => item.dataset.waveformId === segment.id);
    if (!waveform) continue;
    const result = await window.streamAPI.getPodcastWaveform(segment);
    if (result?.ok && result.dataUrl && activePodcastEpisode()?.id === episode.id) {
      waveform.innerHTML = `<img src="${result.dataUrl}" alt="Forma de onda de ${escapeHtml(segment.name)}" />`;
    } else {
      waveform.innerHTML = '<span class="waveform-placeholder">Forma de onda no disponible</span>';
    }
  }
}

function renderPodcastClipLibrary() {
  const episode = activePodcastEpisode();
  if (!episode) return;
  const selectedIds = new Set((episode.segments || []).map((segment) => segment.sourceId));
  els.podcastClipLibrary.innerHTML = '';
  if (!libraryCache.tracks || libraryCache.tracks.length === 0) {
    els.podcastClipLibrary.innerHTML = '<p class="track-list-empty">Importa pistas en Biblioteca para usarlas aquí.</p>';
    return;
  }

  libraryCache.tracks.forEach((track) => {
    const row = document.createElement('div');
    row.className = 'podcast-clip-row';
    row.innerHTML = `
      <span class="podcast-clip-icon">${window.renderIcon('play', 14)}</span>
      <span class="podcast-clip-copy"><strong>${escapeHtml(track.name)}</strong><small>${formatShort(track.durationSeconds)} · MP3 / Audio</small></span>
      <button type="button" class="btn-secondary btn-add-clip" data-add-clip="${track.id}">${selectedIds.has(track.id) ? 'Añadir otra vez' : 'Añadir'}</button>
    `;
    els.podcastClipLibrary.appendChild(row);
  });
}

const podcastMetricsCache = new Map();

function getEpisodeMixSettings(episode) {
  const settings = episode?.mixSettings || {};
  return {
    duckingEnabled: settings.duckingEnabled !== false,
    duckAmount: Number.isFinite(Number(settings.duckAmount)) ? Number(settings.duckAmount) : 0.35,
    duckThresholdDb: Number.isFinite(Number(settings.duckThresholdDb)) ? Number(settings.duckThresholdDb) : -32,
    duckAttackMs: Number.isFinite(Number(settings.duckAttackMs)) ? Number(settings.duckAttackMs) : 80,
    duckReleaseMs: Number.isFinite(Number(settings.duckReleaseMs)) ? Number(settings.duckReleaseMs) : 420,
    busGain: settings.busGain || { voice: 1, music: 1, identity: 1 }
  };
}

function formatMeasuredDb(value, suffix = 'dB') {
  const number = Number(value);
  return !Number.isFinite(number) || number <= -99 ? `-inf ${suffix}` : `${number.toFixed(1)} ${suffix}`;
}

function renderMixMetrics(metrics) {
  const tracks = metrics?.tracks || {};
  ['voice', 'music', 'identity'].forEach((track) => {
    const values = tracks[track] || {};
    const key = track[0].toUpperCase() + track.slice(1);
    els[`mixRms${key}`].textContent = formatMeasuredDb(values.rmsDb);
    els[`mixLufs${key}`].textContent = formatMeasuredDb(values.lufs, 'LUFS');
    els[`mixPeak${key}`].textContent = formatMeasuredDb(values.peakDb);
    els[`mixSegments${key}`].textContent = `${values.segments || 0} clip${values.segments === 1 ? '' : 's'}`;
  });
}

function renderMixMonitor() {
  const episode = activePodcastEpisode();
  if (!episode) return;
  const settings = getEpisodeMixSettings(episode);
  els.mixDuckingEnabled.checked = settings.duckingEnabled;
  els.mixDuckAmount.value = String(settings.duckAmount);
  els.mixDuckAmountOutput.textContent = `${Math.round(settings.duckAmount * 100)}%`;
  els.mixDuckThreshold.value = String(settings.duckThresholdDb);
  els.mixDuckThresholdOutput.textContent = `${settings.duckThresholdDb} dB`;
  renderMixMetrics(podcastMetricsCache.get(episode.id));
}

function readMixSettingsFromUi(episode) {
  if (!episode) return;
  const settings = getEpisodeMixSettings(episode);
  settings.duckingEnabled = els.mixDuckingEnabled.checked;
  settings.duckAmount = Math.min(1, Math.max(0, Number(els.mixDuckAmount.value) || 0));
  settings.duckThresholdDb = Math.min(0, Math.max(-60, Number(els.mixDuckThreshold.value) || -32));
  episode.mixSettings = settings;
  els.mixDuckAmountOutput.textContent = `${Math.round(settings.duckAmount * 100)}%`;
  els.mixDuckThresholdOutput.textContent = `${settings.duckThresholdDb} dB`;
}

async function measureActivePodcastMix() {
  const episode = activePodcastEpisode();
  if (!episode) return;
  els.btnMeasureMix.disabled = true;
  els.btnMeasureMix.textContent = 'Midiendo…';
  try {
    const metrics = await window.streamAPI.measurePodcastEpisode(episode);
    podcastMetricsCache.set(episode.id, metrics);
    renderMixMetrics(metrics);
    appendLog('Medición RMS/LUFS completada para los buses de voz, música e identidad.');
  } catch (error) {
    appendLog(`No se pudo medir la mezcla: ${error.message}`);
    window.SoundFX.error();
  } finally {
    els.btnMeasureMix.disabled = false;
    els.btnMeasureMix.textContent = 'Medir mezcla';
  }
}

function renderPodcastEditor() {
  const episode = activePodcastEpisode();
  const hasEpisode = Boolean(episode);
  els.podcastEditor.hidden = !hasEpisode;
  els.podcastEmptyState.hidden = hasEpisode;
  if (!episode) return;

  els.episodeEditorTitle.textContent = episode.title;
  els.episodeTitle.value = episode.title;
  els.episodeDescription.value = episode.description || '';
  els.episodeStatusPill.textContent = episode.status === 'exported' ? 'EXPORTADO' : 'BORRADOR';
  els.episodeStatusPill.classList.toggle('is-exported', episode.status === 'exported');
  renderMixMonitor();
  renderPodcastTimeline();
  renderPodcastClipLibrary();
  paintIcons(els.podcastEditor);
}

function renderPodcastStudio() {
  renderEpisodeList();
  renderPodcastEditor();
}

async function loadPodcastStudio() {
  podcastEpisodes = await window.streamAPI.listEpisodes();
  if (!activeEpisodeId || !podcastEpisodes.some((episode) => episode.id === activeEpisodeId)) {
    activeEpisodeId = podcastEpisodes[0]?.id || null;
  }
  renderPodcastStudio();
}

async function createPodcastEpisode() {
  window.SoundFX.click();
  const episode = await window.streamAPI.createEpisode({ title: `Episodio ${podcastEpisodes.length + 1}` });
  updatePodcastEpisodes(episode);
  activeEpisodeId = episode.id;
  renderPodcastStudio();
  switchView('podcast');
  els.episodeTitle.focus();
}

async function saveActivePodcastEpisode({ silent = false, resetExport = true } = {}) {
  const episode = activePodcastEpisode();
  if (!episode) return null;
  const patch = {
    title: els.episodeTitle.value.trim() || 'Sin título',
    description: els.episodeDescription.value.trim(),
    mixSettings: episode.mixSettings,
    segments: episode.segments
  };
  if (resetExport) {
    patch.status = 'draft';
    patch.exportPath = null;
    patch.exportedAt = null;
  }
  const updated = await window.streamAPI.updateEpisode(episode.id, patch);
  updatePodcastEpisodes(updated);
  if (!silent) appendLog(`Episodio guardado: ${updated.title}`);
  renderPodcastStudio();
  return updated;
}

async function addPodcastClip(trackId) {
  const episode = activePodcastEpisode();
  const track = libraryCache.tracks.find((item) => item.id === trackId);
  if (!episode || !track) return;
  episode.segments.push({ id: makeClientId(), type: 'library', sourceId: track.id, name: track.name, durationSeconds: Number(track.durationSeconds) || 0, trimStart: 0, trimEnd: Number(track.durationSeconds) || null });
  await saveActivePodcastEpisode({ silent: true });
  window.SoundFX.success();
}

async function removePodcastClip(index) {
  const episode = activePodcastEpisode();
  if (!episode) return;
  episode.segments.splice(index, 1);
  await saveActivePodcastEpisode({ silent: true });
  window.SoundFX.click();
}

async function movePodcastClip(index, direction) {
  const episode = activePodcastEpisode();
  if (!episode) return;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= episode.segments.length) return;
  const [segment] = episode.segments.splice(index, 1);
  episode.segments.splice(nextIndex, 0, segment);
  await saveActivePodcastEpisode({ silent: true });
  window.SoundFX.click();
}

els.btnNewEpisode.addEventListener('click', createPodcastEpisode);
els.btnEmptyNewEpisode.addEventListener('click', createPodcastEpisode);
els.recordVoiceButton.addEventListener('click', togglePodcastVoiceRecording);
els.btnMeasureMix.addEventListener('click', measureActivePodcastMix);
[els.mixDuckingEnabled, els.mixDuckAmount, els.mixDuckThreshold].forEach((control) => {
  control.addEventListener('input', () => readMixSettingsFromUi(activePodcastEpisode()));
  control.addEventListener('change', async () => {
    readMixSettingsFromUi(activePodcastEpisode());
    await saveActivePodcastEpisode({ silent: true });
  });
});
window.streamAPI.onPodcastRecordingState((payload) => {
  if (payload.state === 'recording') {
    setPodcastRecordingUi('recording', payload);
  } else if (payload.state === 'stopped') {
    setPodcastRecordingUi('stopped', payload);
  } else if (payload.state === 'error') {
    setPodcastRecordingUi('error', payload);
  }
});
window.streamAPI.onPodcastRecordingLevel((payload) => {
  updatePodcastRecordingLevel(payload);
});
els.episodeList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-episode-id]');
  if (!item) return;
  activeEpisodeId = item.dataset.episodeId;
  renderPodcastStudio();
});
els.podcastClipLibrary.addEventListener('click', (event) => {
  const button = event.target.closest('[data-add-clip]');
  if (button) addPodcastClip(button.dataset.addClip);
});
function updateSegmentMixFromInput(event) {
  const control = event.target.closest('[data-volume-index], [data-fade-in-index], [data-fade-out-index], [data-track-index], [data-start-index]');
  const episode = activePodcastEpisode();
  if (!control || !episode) return false;
  const index = Number(control.dataset.volumeIndex ?? control.dataset.fadeInIndex ?? control.dataset.fadeOutIndex ?? control.dataset.trackIndex ?? control.dataset.startIndex);
  const segment = episode.segments[index];
  if (!segment) return false;
  if (control.dataset.startIndex !== undefined) {
    segment.startTime = Math.max(0, Math.min(86400, Number(control.value) || 0));
    control.value = String(segment.startTime);
  } else if (control.dataset.trackIndex !== undefined) {
    segment.track = ['voice', 'music', 'identity'].includes(control.value) ? control.value : 'music';
  } else if (control.dataset.volumeIndex !== undefined) {
    segment.volume = Math.min(2, Math.max(0, Number(control.value) || 0));
    const output = els.podcastTimeline.querySelector(`[data-volume-output="${index}"]`);
    if (output) output.textContent = `${Math.round(segment.volume * 100)}%`;
  } else if (control.dataset.fadeInIndex !== undefined) {
    segment.fadeIn = Math.min(30, Math.max(0, Number(control.value) || 0));
    control.value = String(segment.fadeIn);
  } else {
    segment.fadeOut = Math.min(30, Math.max(0, Number(control.value) || 0));
    control.value = String(segment.fadeOut);
  }
  return true;
}

function updateAutomationFromInput(event) {
  const control = event.target.closest('[data-envelope-time], [data-envelope-gain]');
  const episode = activePodcastEpisode();
  if (!control || !episode) return false;
  const [segmentIndex, pointIndex] = String(control.dataset.envelopeTime ?? control.dataset.envelopeGain).split(':').map(Number);
  const segment = episode.segments[segmentIndex];
  if (!segment) return false;
  if (!Array.isArray(segment.automation)) segment.automation = [];
  const point = segment.automation[pointIndex];
  if (!point) return false;
  const duration = Math.max(0.1, podcastSegmentDuration(segment));
  if (control.dataset.envelopeTime !== undefined) point.time = Math.min(duration, Math.max(0, Number(control.value) || 0));
  else point.gain = Math.min(2, Math.max(0, Number(control.value) || 0));
  segment.automation.sort((a, b) => Number(a.time) - Number(b.time));
  const output = els.podcastTimeline.querySelector(`[data-envelope-output="${segmentIndex}:${pointIndex}"]`);
  if (output) output.textContent = `${Math.round(Number(point.gain) * 100)}%`;
  return true;
}

function addAutomationPoint(segmentIndex) {
  const episode = activePodcastEpisode();
  const segment = episode?.segments?.[segmentIndex];
  if (!segment) return false;
  const duration = Math.max(0.1, podcastSegmentDuration(segment));
  const points = Array.isArray(segment.automation) ? segment.automation : [];
  if (points.length >= 6) return false;
  let bestGap = 0;
  let insertTime = duration / 2;
  const sorted = [...points].sort((a, b) => Number(a.time) - Number(b.time));
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = Number(sorted[i].time) - Number(sorted[i - 1].time);
    if (gap > bestGap) { bestGap = gap; insertTime = Number(sorted[i - 1].time) + gap / 2; }
  }
  const gain = getEnvelopeGain(points, insertTime, Number(segment.volume) || 1);
  points.push({ time: insertTime, gain });
  segment.automation = points.sort((a, b) => Number(a.time) - Number(b.time));
  return true;
}

function removeAutomationPoint(segmentIndex, pointIndex) {
  const episode = activePodcastEpisode();
  const segment = episode?.segments?.[segmentIndex];
  if (!segment || !Array.isArray(segment.automation) || segment.automation.length <= 2) return false;
  segment.automation.splice(pointIndex, 1);
  return true;
}

function podcastSegmentDuration(segment) {
  const duration = Math.max(0, Number(segment.durationSeconds) || 0);
  const start = Math.max(0, Number(segment.trimStart) || 0);
  const end = Number(segment.trimEnd) > start ? Number(segment.trimEnd) : duration;
  return Math.max(0, end - start);
}

function updateTimelineTrimFromInput(event) {
  const control = event.target.closest('[data-trim-start], [data-trim-end]');
  const episode = activePodcastEpisode();
  if (!control || !episode) return false;
  const index = Number(control.dataset.trimStart ?? control.dataset.trimEnd);
  const segment = episode.segments[index];
  const item = control.closest('[data-timeline-index]');
  if (!segment || !item) return false;
  const duration = Math.max(0.1, Number(segment.durationSeconds) || 0.1);
  let start = Math.max(0, Number(item.querySelector(`[data-trim-start="${index}"]`).value) || 0);
  let end = Math.min(duration, Number(item.querySelector(`[data-trim-end="${index}"]`).value) || duration);
  if (control.dataset.trimStart !== undefined) start = Math.min(start, Math.max(0, end - 0.1));
  if (control.dataset.trimEnd !== undefined) end = Math.max(end, Math.min(duration, start + 0.1));
  segment.trimStart = start;
  segment.trimEnd = end;
  item.querySelector(`[data-trim-start="${index}"]`).value = String(start);
  item.querySelector(`[data-trim-end="${index}"]`).value = String(end);
  const summary = item.querySelector(`[data-trim-summary="${index}"]`);
  if (summary) summary.textContent = `${formatShort(start)} — ${formatShort(end)}`;
  const info = item.querySelector('.timeline-clip-info small');
  if (info) info.textContent = `${formatShort(Math.max(0, end - start))} · ${segment.type === 'recording' ? 'Grabación de voz' : 'Biblioteca'}`;
  els.timelineDuration.textContent = formatShort(podcastEpisodeDuration(episode));
  return true;
}

els.podcastTimeline.addEventListener('input', updateTimelineTrimFromInput);
els.podcastTimeline.addEventListener('input', updateSegmentMixFromInput);
els.podcastTimeline.addEventListener('input', updateAutomationFromInput);
els.podcastTimeline.addEventListener('change', async (event) => {
  const trimChanged = updateTimelineTrimFromInput(event);
  const mixChanged = updateSegmentMixFromInput(event);
  const automationChanged = updateAutomationFromInput(event);
  if (trimChanged || mixChanged || automationChanged) await saveActivePodcastEpisode({ silent: true });
});
els.podcastTimeline.addEventListener('click', async (event) => {
  const preview = event.target.closest('[data-preview-segment]');
  if (preview) return togglePodcastSegmentPreview(Number(preview.dataset.previewSegment), preview);
  const addEnvelope = event.target.closest('[data-add-envelope]');
  if (addEnvelope) { if (addAutomationPoint(Number(addEnvelope.dataset.addEnvelope))) await saveActivePodcastEpisode({ silent: true }); return; }
  const removeEnvelope = event.target.closest('[data-remove-envelope]');
  if (removeEnvelope) { const [segmentIndex, pointIndex] = removeEnvelope.dataset.removeEnvelope.split(':').map(Number); if (removeAutomationPoint(segmentIndex, pointIndex)) await saveActivePodcastEpisode({ silent: true }); return; }
  const remove = event.target.closest('[data-remove-clip]');
  if (remove) return removePodcastClip(Number(remove.dataset.removeClip));
  const moveUp = event.target.closest('[data-move-up]');
  if (moveUp) return movePodcastClip(Number(moveUp.dataset.moveUp), -1);
  const moveDown = event.target.closest('[data-move-down]');
  if (moveDown) return movePodcastClip(Number(moveDown.dataset.moveDown), 1);
});
els.podcastTimeline.addEventListener('dragstart', (event) => {
  const clip = event.target.closest('[data-timeline-index]');
  if (!clip) return;
  draggedTimelineIndex = Number(clip.dataset.timelineIndex);
  clip.classList.add('is-dragging');
});
els.podcastTimeline.addEventListener('dragend', (event) => {
  const clip = event.target.closest('[data-timeline-index]');
  if (clip) clip.classList.remove('is-dragging');
  draggedTimelineIndex = null;
});
els.podcastTimeline.addEventListener('dragover', (event) => event.preventDefault());
els.podcastTimeline.addEventListener('drop', async (event) => {
  event.preventDefault();
  const target = event.target.closest('[data-timeline-index]');
  const episode = activePodcastEpisode();
  if (!target || !episode || draggedTimelineIndex == null) return;
  const targetIndex = Number(target.dataset.timelineIndex);
  if (targetIndex === draggedTimelineIndex) return;
  const [segment] = episode.segments.splice(draggedTimelineIndex, 1);
  episode.segments.splice(targetIndex, 0, segment);
  draggedTimelineIndex = null;
  await saveActivePodcastEpisode({ silent: true });
});
els.episodeTitle.addEventListener('change', () => saveActivePodcastEpisode({ silent: true }));
els.episodeDescription.addEventListener('change', () => saveActivePodcastEpisode({ silent: true }));
els.btnClearTimeline.addEventListener('click', async () => {
  const episode = activePodcastEpisode();
  if (!episode || episode.segments.length === 0) return;
  episode.segments = [];
  await saveActivePodcastEpisode({ silent: true });
});
els.btnSaveEpisode.addEventListener('click', () => saveActivePodcastEpisode());
els.btnDeleteEpisode.addEventListener('click', async () => {
  const episode = activePodcastEpisode();
  if (!episode || !window.confirm(`¿Eliminar el episodio "${episode.title}"?`)) return;
  await window.streamAPI.deleteEpisode(episode.id);
  podcastEpisodes = podcastEpisodes.filter((item) => item.id !== episode.id);
  activeEpisodeId = podcastEpisodes[0]?.id || null;
  renderPodcastStudio();
});
function setPodcastExportBusy(isBusy) {
  podcastExportActive = isBusy;
  els.btnExportEpisode.disabled = isBusy;
  els.btnCancelExport.hidden = !isBusy;
  els.btnCancelExport.disabled = false;
}

els.btnCancelExport.addEventListener('click', async () => {
  if (!podcastExportActive) return;
  els.btnCancelExport.disabled = true;
  els.podcastExportLabel.textContent = 'Cancelando exportación…';
  await window.streamAPI.cancelPodcastExport();
});

els.btnExportEpisode.addEventListener('click', async () => {
  const episode = await saveActivePodcastEpisode({ silent: true });
  if (!episode || episode.segments.length === 0) {
    appendLog('Añade al menos un clip antes de exportar el episodio.');
    window.SoundFX.error();
    return;
  }
  setPodcastExportBusy(true);
  els.podcastExportStatus.hidden = false;
  els.podcastExportLabel.textContent = 'Selecciona dónde guardar el episodio…';
  const result = await window.streamAPI.exportEpisode(episode.id);
  if (!result || !result.ok) {
    if (result?.reason !== 'cancelled') {
      setPodcastExportBusy(false);
      els.podcastExportStatus.hidden = true;
      appendLog(`No se pudo exportar el episodio: ${result?.message || 'operación cancelada'}`);
    }
  }
});
window.streamAPI.onPodcastExportProgress((payload) => {
  els.podcastExportStatus.hidden = false;
  if (payload.state === 'starting') {
    setPodcastExportBusy(true);
    els.podcastExportLabel.textContent = 'Preparando exportación…';
    els.podcastExportPercent.textContent = '0%';
    els.podcastExportFill.style.width = '0%';
  } else if (payload.state === 'exporting') {
    const percent = Math.round(payload.percent || 0);
    els.podcastExportLabel.textContent = 'Exportando episodio…';
    els.podcastExportPercent.textContent = `${percent}%`;
    els.podcastExportFill.style.width = `${percent}%`;
    els.podcastExportMeta.textContent = `${formatShort(payload.elapsedSeconds)} de ${formatShort(payload.totalSeconds)}`;
  } else if (payload.state === 'completed') {
    setPodcastExportBusy(false);
    els.podcastExportLabel.textContent = 'Episodio exportado correctamente';
    els.podcastExportPercent.textContent = '100%';
    els.podcastExportFill.style.width = '100%';
    els.podcastExportMeta.textContent = payload.outputPath || '';
    window.SoundFX.success();
    loadPodcastStudio();
  } else if (payload.state === 'cancelled') {
    setPodcastExportBusy(false);
    els.podcastExportLabel.textContent = 'Exportación cancelada';
    els.podcastExportPercent.textContent = '—';
    els.podcastExportMeta.textContent = payload.message || 'No se conservó ningún archivo parcial.';
  } else if (payload.state === 'error') {
    setPodcastExportBusy(false);
    els.podcastExportLabel.textContent = 'Error durante la exportación';
    els.podcastExportMeta.textContent = payload.message || 'Revisa la actividad.';
    window.SoundFX.error();
  }
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
async function bootstrap() {
  paintIcons();
  try {
    const providers = await window.streamAPI.listProviders();
    if (Array.isArray(providers) && providers.length > 0) providerCatalog = providers;
  } catch {
    appendLog('Aviso: se usará el catálogo local de proveedores.');
  }
  populateProviderOptions();
  updateProviderUi();
  buildSegmentedMeter(els.vuMeter, VU_SEGMENT_COUNT);
  buildSegmentedMeter(els.micTestMeter, MIC_TEST_SEGMENT_COUNT);
  buildSegmentedMeter(els.recordingMeter, 20);
  buildSpectrumMeter();
  startAudioVisualLoop();
  buildDayPicker();
  await loadDevices();
  await loadLibrary();
  await loadPodcastStudio();
  // La configuracion guardada se aplica DESPUES de cargar la biblioteca:
  // los pickers de intro/outro necesitan sus opciones (setTracks) listas
  // antes de poder marcar el track guardado como seleccionado (setValue).
  const settings = await window.streamAPI.loadSettings();
  applySettings(settings);
  const schedule = await window.streamAPI.loadSchedule();
  applySchedule(schedule);
  await loadAppInfo();
  try {
    const cachedUpdateState = await window.streamAPI.getUpdateState();
    if (cachedUpdateState && cachedUpdateState.state && cachedUpdateState.state !== 'idle') {
      handleUpdateState(cachedUpdateState);
    }
  } catch {
    appendLog('Aviso: no se pudo recuperar el estado del actualizador.');
  }
  appendLog('Interfaz cargada.');
}

bootstrap();

// ---------------------------------------------------------------------------
// Modo mini-ventana flotante (siempre-encima, compacto). Entra siempre por
// la vista Estudio: no tiene sentido un mini-reproductor mostrando la
// Biblioteca o el Historial.
// ---------------------------------------------------------------------------
async function setCompactMode(enabled) {
  const result = await window.streamAPI.setCompactMode(enabled);
  isCompactMode = result.compact;
  els.appShell.hidden = isCompactMode;
  els.compactBar.hidden = !isCompactMode;
  if (isCompactMode) {
    switchView('studio');
  }
}

els.btnToggleCompact.addEventListener('click', () => {
  window.SoundFX.click();
  setCompactMode(true);
});

els.btnCompactRestore.addEventListener('click', () => {
  window.SoundFX.click();
  setCompactMode(false);
});

els.btnCompactStop.addEventListener('click', () => {
  els.btnStop.click();
});
