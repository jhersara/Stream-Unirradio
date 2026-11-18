const state = require('./state');
const { sendStatus } = require('../../ipc/events');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function elapsedSeconds() {
  const session = state.session;
  if (!session || !session.startedAt) return 0;
  return (Date.now() - session.startedAt) / 1000;
}

function startStatusTicker() {
  const session = state.session;
  if (!session) return;
  session.statusTimer = setInterval(() => {
    if (state.session !== session) return;
    sendStatus(session.mainWindow, session.phase, elapsedSeconds());
  }, 1000);
}

function stopStatusTicker() {
  const session = state.session;
  if (session && session.statusTimer) {
    clearInterval(session.statusTimer);
    session.statusTimer = null;
  }
}

module.exports = { wait, elapsedSeconds, startStatusTicker, stopStatusTicker };
