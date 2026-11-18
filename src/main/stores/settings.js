const path = require('path');
const { app, safeStorage } = require('electron');
const { createJsonStore } = require('./json-store');

/**
 * Configuracion del formulario (servidor, credenciales, dispositivo, pistas
 * activas). La contrasena se cifra con safeStorage (DPAPI en Windows) y solo
 * se guarda cifrada; el resto va en texto plano dentro de settings.json.
 */
const DEFAULT_SETTINGS = {
  provider: 'zeno-icecast',
  server: 'link.zeno.fm',
  port: '80',
  mount: '',
  streamId: '',
  user: 'source',
  deviceId: '',
  introEnabled: true,
  outroEnabled: true,
  introTrackId: '',
  outroTrackId: '',
  gain: 1
};

const store = createJsonStore({
  filePath: () => path.join(app.getPath('userData'), 'settings.json'),
  fallback: () => ({})
});

function loadSettings() {
  const saved = store.get() || {};
  let password = '';
  if (saved.passwordEncrypted) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        password = safeStorage.decryptString(Buffer.from(saved.passwordEncrypted, 'base64'));
      }
    } catch {
      password = '';
    }
  }

  const { passwordEncrypted, ...rest } = saved;
  // `provider` se anadio despues de la primera version: el merge mantiene
  // compatibilidad con settings.json antiguos.
  return { ...DEFAULT_SETTINGS, ...rest, provider: rest.provider || DEFAULT_SETTINGS.provider, password };
}

function saveSettings(settings) {
  const { password, ...rest } = settings || {};
  const toSave = { ...rest };

  if (password && safeStorage.isEncryptionAvailable()) {
    toSave.passwordEncrypted = safeStorage.encryptString(password).toString('base64');
  }
  // Si el cifrado del sistema no esta disponible, deliberadamente NO se guarda
  // la contrasena en texto plano.

  store.set(toSave);
}

module.exports = { loadSettings, saveSettings };
