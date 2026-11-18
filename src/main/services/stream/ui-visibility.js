/**
 * Decide si hace falta calcular vumetro/espectro. Solo se calculan cuando la
 * ventana es visible Y la vista actual del renderer los muestra; el resto del
 * tiempo (ventana minimizada, otra pestana) no se gasta CPU en ello.
 */
let windowVisible = true;
let rendererDemand = true;

module.exports = {
  setWindowVisible(value) { windowVisible = Boolean(value); },
  setRendererDemand(value) { rendererDemand = Boolean(value); },
  isMetricsWanted() { return windowVisible && rendererDemand; }
};
