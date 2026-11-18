const fs = require('fs');
const { protocol } = require('electron');
const libraryManager = require('../services/media/library');
const mediaPreviewStore = require('../services/media/preview-store');

const SCHEME = 'streamradio';

/** Debe ejecutarse ANTES de app.ready. */
function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ]);
}

/** streamradio://track/<id> (biblioteca) y streamradio://podcast/<token> (preescucha). */
function registerMediaProtocol() {
  protocol.registerFileProtocol(SCHEME, (request, callback) => {
    try {
      const url = new URL(request.url);
      const resourceId = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      let filePath = null;
      if (url.hostname === 'track') filePath = libraryManager.getTrackPath(resourceId);
      else if (url.hostname === 'podcast') filePath = mediaPreviewStore.resolve(resourceId);

      if (!filePath) {
        callback({ error: -6 });
        return;
      }
      fs.promises.access(filePath, fs.constants.R_OK)
        .then(() => callback({ path: filePath }))
        .catch(() => callback({ error: -6 }));
    } catch {
      callback({ error: -2 });
    }
  });
}

module.exports = { registerSchemes, registerMediaProtocol };
