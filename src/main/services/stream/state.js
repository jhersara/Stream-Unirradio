/**
 * Estado compartido del servicio de transmision. Solo se soporta UNA sesion
 * activa a la vez (un unico boton Iniciar/Detener).
 */
module.exports = {
  session: null,          // sesion en curso
  pendingStart: null,     // conexion en proceso de establecerse
  pendingRecording: null, // grabacion local terminada pendiente de guardar
  previewState: null      // prueba de microfono
};
