const path = require('path');

// src/main/utils -> raiz del proyecto
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

module.exports = {
  PROJECT_ROOT,
  RENDERER_ENTRY: path.join(PROJECT_ROOT, 'src', 'renderer', 'index.html'),
  PRELOAD_PATH: path.join(PROJECT_ROOT, 'src', 'preload', 'preload.js'),
  ICON_PATH: path.join(PROJECT_ROOT, 'resources', 'icon.ico'),
  DEV_FFMPEG_PATH: path.join(PROJECT_ROOT, 'resources', 'ffmpeg', 'ffmpeg.exe')
};
