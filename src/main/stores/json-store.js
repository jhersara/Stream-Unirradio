const fs = require('fs');
const path = require('path');

const registry = new Set();

/**
 * Almacen JSON con cache en memoria: se lee del disco una sola vez y las
 * escrituras se agrupan (debounce) y se hacen de forma asincrona y atomica
 * (archivo temporal + rename), sin bloquear el proceso principal.
 *
 * - get()  -> valor actual en memoria (carga sincrona solo la primera vez)
 * - set(v) -> reemplaza el valor y programa la escritura
 * - flushSync() -> escritura inmediata (cierre de la app)
 */
function createJsonStore({ filePath, fallback, migrate = null, debounceMs = 300 }) {
  const resolvePath = typeof filePath === 'function' ? filePath : () => filePath;
  let cache = null;
  let loaded = false;
  let dirty = false;
  let timer = null;
  let writing = Promise.resolve();

  function load() {
    if (loaded) return cache;
    loaded = true;
    try {
      cache = JSON.parse(fs.readFileSync(resolvePath(), 'utf-8'));
    } catch {
      cache = fallback();
    }
    if (migrate) {
      const migrated = migrate(cache);
      if (migrated !== undefined) cache = migrated;
    }
    return cache;
  }

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
    timer.unref?.();
  }

  function get() {
    return load();
  }

  function set(value) {
    cache = value;
    loaded = true;
    schedule();
    return cache;
  }

  async function writeAtomic(target, data) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, data, 'utf-8');
    try {
      await fs.promises.rename(tmp, target);
    } catch {
      // Windows puede bloquear el rename (antivirus/OneDrive): escritura directa.
      await fs.promises.writeFile(target, data, 'utf-8');
      fs.promises.rm(tmp, { force: true }).catch(() => {});
    }
  }

  function flush() {
    if (!dirty) return writing;
    dirty = false;
    const target = resolvePath();
    const data = JSON.stringify(cache, null, 2);
    writing = writing.then(() => writeAtomic(target, data)).catch(() => {});
    return writing;
  }

  function flushSync() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    try {
      const target = resolvePath();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(cache, null, 2), 'utf-8');
    } catch { /* noop */ }
  }

  const store = { get, set, flush, flushSync };
  registry.add(store);
  return store;
}

function flushAllSync() {
  registry.forEach((store) => store.flushSync());
}

module.exports = { createJsonStore, flushAllSync };
