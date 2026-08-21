const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

/**
 * Persiste la configuracion del formulario (servidor, credenciales,
 * dispositivo, pistas activas) para que el usuario no tenga que volver a
 * escribirla cada vez que abre la app.
 *
 * La contrasena se cifra con `safeStorage` (usa DPAPI en Windows) y se
 * guarda por separado del resto de campos, que van en texto plano dentro de
 * settings.json -- son datos de conexion no sensibles salvo la contrasena.
 */

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

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

function loadSettings() {
  const settingsPath = getSettingsPath();
  let saved = {};
  if (fs.existsSync(settingsPath)) {
    try {
      saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      saved = {};
    }
  }

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
  // `provider` se añadió después de la primera versión. El merge con los
  // valores por defecto mantiene compatibilidad con settings.json antiguos.
  return { ...DEFAULT_SETTINGS, ...rest, provider: rest.provider || DEFAULT_SETTINGS.provider, password };
}

function saveSettings(settings) {
  const { password, ...rest } = settings || {};
  const toSave = { ...rest };

  if (password) {
    if (safeStorage.isEncryptionAvailable()) {
      toSave.passwordEncrypted = safeStorage.encryptString(password).toString('base64');
    }
    // Si el cifrado del sistema no esta disponible (muy raro en Windows),
    // deliberadamente NO se guarda la contrasena en texto plano; el usuario
    // tendra que reescribirla la proxima vez, mejor eso que dejarla expuesta.
  }

  fs.writeFileSync(getSettingsPath(), JSON.stringify(toSave, null, 2), 'utf-8');
}

module.exports = { loadSettings, saveSettings };
