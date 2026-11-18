const { spawn } = require('child_process');
const os = require('os');

function killQuietly(proc) {
  try { proc.kill(); } catch { /* noop */ }
}

/** Baja la prioridad de un proceso hijo para que no compita con la emision en vivo. */
function lowerPriority(proc) {
  if (!proc || !proc.pid) return;
  try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* noop */ }
}

/**
 * Cierre ordenado: cierra stdin (EOF), espera a que el proceso termine solo
 * y solo lo mata si excede timeoutMs. Evita archivos/streams truncados.
 */
function gracefullyEndProcess(proc, timeoutMs) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      resolve();
    };
    const graceTimer = setTimeout(() => {
      killQuietly(proc);
      finish();
    }, timeoutMs);
    proc.once('close', finish);

    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.end();
      } else {
        killQuietly(proc);
        finish();
      }
    } catch {
      killQuietly(proc);
      finish();
    }
  });
}

/**
 * En Windows, proc.kill() sincrono puede bloquear Electron mientras FFmpeg
 * tiene datos en sus pipes: se delega a un taskkill desacoplado.
 */
function requestProcessTermination(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32' && proc.pid) {
    try {
      const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore'
      });
      killer.unref?.();
      return;
    } catch { /* noop */ }
  }
  killQuietly(proc);
}

/** Cierre rapido (maximo 1s) para procesos secundarios como la grabacion local. */
function stopProcessQuickly(proc, timeoutMs = 1000) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    proc.once('close', finish);
    try {
      if (proc.stdin && !proc.stdin.destroyed) proc.stdin.destroy();
    } catch { /* noop */ }
    requestProcessTermination(proc);
  });
}

module.exports = { killQuietly, lowerPriority, gracefullyEndProcess, requestProcessTermination, stopProcessQuickly };
