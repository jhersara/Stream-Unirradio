const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/** Diagnostico de ejecucion (ventana sin respuesta, crash del renderer...). */
function writeRuntimeDiagnostic(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  const logsDir = app.getPath('logs');
  fs.promises.mkdir(logsDir, { recursive: true })
    .then(() => fs.promises.appendFile(path.join(logsDir, 'stream-radio-runtime.log'), line, 'utf8'))
    .catch(() => {});
}

module.exports = { writeRuntimeDiagnostic };
