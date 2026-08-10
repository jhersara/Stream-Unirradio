const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Resuelve la ruta al binario de ffmpeg embebido con la app. En desarrollo
 * apunta a resources/ffmpeg/ffmpeg.exe; empaquetado, a process.resourcesPath
 * (ver "extraResources" en package.json). Si no se encuentra, cae a "ffmpeg"
 * confiando en el PATH del sistema como ultimo recurso.
 */
function resolveFfmpegPath() {
  const candidates = [];

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'));
  } else {
    candidates.push(path.join(__dirname, '..', '..', 'resources', 'ffmpeg', 'ffmpeg.exe'));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'ffmpeg';
}

/**
 * Obtiene la duracion en segundos de un archivo de audio ejecutando
 * `ffmpeg -i <archivo>` y parseando la linea "Duration: HH:MM:SS.xx" de
 * stderr (ffmpeg no soporta consultar metadatos sin intentar procesar, pero
 * con -i solo y sin salida definida termina rapido tras imprimir el header).
 * Devuelve null si ffmpeg no esta disponible o no se pudo determinar.
 */
function getDurationSeconds(filePath) {
  return new Promise((resolve) => {
    const ffmpegPath = resolveFfmpegPath();
    let proc;
    try {
      proc = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }

    let stderrData = '';
    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const match = stderrData.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) {
        resolve(null);
        return;
      }
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      resolve(hours * 3600 + minutes * 60 + seconds);
    });
  });
}

module.exports = { getDurationSeconds, resolveFfmpegPath };
