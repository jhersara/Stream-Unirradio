const crypto = require('crypto');
const path = require('path');

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const entries = new Map();

function register(filePath) {
  const token = crypto.randomUUID();
  entries.set(token, {
    filePath: path.resolve(filePath),
    expiresAt: Date.now() + PREVIEW_TTL_MS
  });
  return token;
}

function resolve(token) {
  if (!token) return null;
  const entry = entries.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(token);
    return null;
  }
  return entry.filePath;
}

function cleanup() {
  const now = Date.now();
  for (const [token, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(token);
  }
}

const cleanupTimer = setInterval(cleanup, 5 * 60 * 1000);
cleanupTimer.unref?.();

module.exports = { register, resolve, cleanup };
