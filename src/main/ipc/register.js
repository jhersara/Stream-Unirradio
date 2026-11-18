const { registerStreamHandlers } = require('./handlers/stream');
const { registerLibraryHandlers } = require('./handlers/library');
const { registerPodcastHandlers } = require('./handlers/podcast');
const { registerAppHandlers } = require('./handlers/app');

/**
 * Registra los canales IPC expuestos al renderer (ver src/preload/preload.js).
 * Se llama UNA sola vez; los handlers resuelven la ventana con getWindow().
 */
function registerIpcHandlers(getWindow) {
  registerStreamHandlers(getWindow);
  registerLibraryHandlers(getWindow);
  registerPodcastHandlers(getWindow);
  registerAppHandlers(getWindow);
}

module.exports = { registerIpcHandlers };
