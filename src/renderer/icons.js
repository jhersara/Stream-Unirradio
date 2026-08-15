/**
 * Set de iconos de linea, estilo minimalista (stroke, esquinas redondeadas)
 * en el mismo espiritu visual de librerias como Lucide/Feather, escritos a
 * mano para no depender de un bundler en el renderer (Electron sin
 * nodeIntegration no puede hacer `require()` de paquetes npm aqui). Si mas
 * adelante se quiere el set exacto de Lucide, se puede instalar
 * `lucide-static` y reemplazar estos strings por los .svg reales sin tocar
 * el resto del codigo (todo pasa por window.renderIcon).
 */
(function () {
  const ICONS = {
    studio: `<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>`,
    library: `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
    settings: `<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>`,
    info: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
    play: `<polygon points="6 3 20 12 6 21 6 3"/>`,
    stop: `<rect x="5" y="5" width="14" height="14" rx="2"/>`,
    upload: `<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>`,
    trash: `<polyline points="3 6 5 6 21 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>`,
    volume: `<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a9 9 0 0 1 0 12"/>`,
    chevronRight: `<polyline points="9 18 15 12 9 6"/>`,
    close: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
    check: `<polyline points="20 6 9 17 4 12"/>`,
    radio: `<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 1 7 0"/><path d="M5.5 5.5a9 9 0 0 1 13 0"/><path d="M15.5 15.5a5 5 0 0 1-7 0"/><path d="M18.5 18.5a9 9 0 0 1-13 0"/>`,
    refresh: `<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>`,
    history: `<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3.5 2"/>`,
    compact: `<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="13" y="13" width="6" height="6" rx="1"/>`,
    expand: `<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>`
  };

  function renderIcon(name, sizePx) {
    const size = sizePx || 18;
    const body = ICONS[name] || ICONS.info;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="icon icon-${name}">${body}</svg>`;
  }

  window.ICONS = ICONS;
  window.renderIcon = renderIcon;
})();
