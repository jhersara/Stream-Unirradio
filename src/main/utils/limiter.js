/** Limita cuantas tareas asincronas corren a la vez (el resto espera en cola). */
function createLimiter(maxConcurrent) {
  let active = 0;
  const waiting = [];

  function next() {
    if (active >= maxConcurrent || waiting.length === 0) return;
    active += 1;
    const { task, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  }

  return function run(task) {
    return new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      next();
    });
  };
}

module.exports = { createLimiter };
