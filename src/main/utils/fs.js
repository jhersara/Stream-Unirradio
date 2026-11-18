const fs = require('fs');

/** existsSync sin bloquear el event loop. */
function pathExists(filePath) {
  return fs.promises.access(filePath).then(() => true, () => false);
}

module.exports = { pathExists };
