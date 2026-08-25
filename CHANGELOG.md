# Historial de cambios

## [1.3.2] — Corrección crítica de audio y responsividad

### Transmisión y grabación

- Desacoplado el cierre del grabador local del handler IPC de **Detener**: la emisión libera el encoder y responde sin esperar a que una tubería de grabación con backpressure acepte EOF.
- Añadidas colas acotadas, backpressure y escritura cooperativa fuera del callback nativo de PortAudio para proteger la continuidad del vivo y limitar el consumo de memoria.
- Sustituida la carpeta predeterminada redirigible de Documentos por `%APPDATA%/Stream Radio/Stream Radio - Grabaciones/`; el formulario integrado sigue permitiendo seleccionar otra carpeta.
- Añadidos límites de tiempo a las operaciones de acceso, creación, movimiento y copia de grabaciones para que una unidad lenta o una carpeta de red no congele Electron.
- Movido el cálculo RMS/pico y el espectro de 24 bandas a un worker dedicado, con un máximo de dos solicitudes de métricas pendientes.

### Biblioteca e interfaz

- Cacheado en memoria el índice de Biblioteca para evitar releer y parsear `library.json` en cada solicitud `streamradio://`.
- Limitado el registro visual del renderer a 350 líneas y eliminado el desplazamiento forzado cuando el usuario no está al final.
- Conservado el flujo de guardado integrado con estados visibles de procesamiento, selección de nombre/carpeta, guardado correcto y error recuperable.

### Validación

- E2E local con servidor Icecast emulado: transmisión sin grabación, transmisión con grabación, detención, guardado predeterminado y verificación de renderer responsivo.
- Smoke test de Biblioteca: ocho cargas consecutivas de la pista real más corta (`5254d8f3-216a-41fa-a35c-8c1dd0f3323a`, aproximadamente 5,59 s).
- Regresiones de adaptadores Icecast/SHOUTcast y perfil FFmpeg ejecutadas correctamente.

---

## [1.3.1] — Estabilidad y rendimiento

### Preescucha y consumo de memoria

- Sustituida la conversión completa de pistas de la Biblioteca a base64 por un protocolo local seguro con carga progresiva de Chromium.
- Aplicada la misma estrategia a la preescucha de segmentos de Podcast Studio.
- Eliminada la posibilidad de que una pista grande provoque un pico innecesario de memoria al reproducirse.

### Rendimiento de la interfaz

- El vúmetro y el ecualizador se pintan únicamente durante una emisión activa.
- El renderizado visual se limita a 20 FPS y se pausa cuando la ventana está oculta o minimizada.
- Reducida la frecuencia de telemetría de audio a 10 actualizaciones por segundo, conservando la interpolación visual.

### Cierre de grabaciones

- El archivo se finaliza primero en una ubicación temporal y el selector de nombre/carpeta se ejecuta después de terminar el vivo.
- El movimiento de archivos usa operaciones asíncronas para no congelar Electron durante copias grandes o entre unidades.
- Añadido estado visible de `Procesando`, `Selecciona nombre y carpeta`, `Guardando` y `Grabación guardada`.

---

## [1.3.0] — Guardado personalizado de grabaciones

### Grabación local

- La grabación se mantiene en un archivo temporal durante la emisión para no interrumpir el flujo en vivo.
- Al detener la transmisión y finalizar el cierre de FFmpeg, aparece el selector nativo de Windows para definir el nombre y la carpeta de destino.
- Se conserva `Documentos\\Stream Radio - Grabaciones` como ubicación predeterminada cuando el usuario cancela el diálogo o cuando la sesión es automática.
- Se evita sobrescribir grabaciones existentes mediante nombres numerados y se añade `.mp3` automáticamente cuando hace falta.
- El historial registra la ruta definitiva del archivo después de moverlo.
- Las grabaciones programadas continúan guardándose sin interacción en la ubicación predeterminada.

### Documentación

- Actualizado el README con el flujo de selección de nombre y carpeta y su solución de problemas.

---

## [1.2.0] — Correcciones de producción y experiencia de uso

### Podcast Studio

- Simplificado el flujo principal en tres pasos: grabar o añadir clips, ordenar la historia y guardar/exportar.
- Convertidas la mezcla automática, el ducking, la medición RMS/LUFS y los controles técnicos por clip en paneles avanzados plegables.
- Conservadas las funciones de recorte IN/OUT, volumen, fades, automatización, preescucha y exportación MP3.

### Auto-updater

- La barra de descarga permanece visible al 100% cuando la actualización termina.
- Añadido el estado `Descarga completada · lista para instalar` junto con el botón `Reiniciar para instalar`.
- Añadida recuperación del último estado del actualizador si la descarga termina antes de que el renderer finalice su carga.

### Transmisión y grabación local

- El grabador local ya no bloquea el camino crítico de inicio de la transmisión.
- El grabador se inicia después de confirmar que el encoder principal está preparado.
- Añadido control de backpressure para que una grabación local lenta no detenga la emisión en vivo.
- Limitado el grabador local a un hilo FFmpeg; si falla, la transmisión continúa.
- Verificado el pipe PCM → FFmpeg → MP3 con una prueba de integración local.

### Documentación

- Reescrito el README principal con arquitectura, instalación, proveedores, flujo de transmisión, Podcast Studio, auto-updater, solución de problemas y capturas visuales.
- Añadidas capturas públicas en `docs/screenshots/` sin credenciales ni datos privados.

---

## [1.1.0] — Stream Radio

### Streaming y proveedores

- Añadidos adaptadores para **Zeno.fm · Icecast**, **Centova Cast · Icecast** y **Centova Cast · SHOUTcast**.
- Añadido el puente TCP/ICY para fuentes SHOUTcast con autenticación, Stream ID opcional y control de backpressure.
- Integradas reconexiones automáticas y cancelación segura durante handshakes pendientes.
- Conservada la secuencia de emisión `intro → voz en vivo → outro`.
- Añadido control de **Pausar/Reanudar**. Durante la pausa, la conexión permanece activa y se envía silencio PCM en lugar del micrófono.

### Interfaz y experiencia de uso

- Reubicados los controles **Iniciar**, **Pausar/Reanudar** y **Detener** en la barra superior.
- Añadido menú de navegación desplegable: colapsable en escritorio y convertido en drawer responsive en ventanas pequeñas.
- Mejorado el comportamiento responsive para resoluciones estrechas.
- Añadida preescucha de pistas importadas desde Biblioteca.
- Añadida preescucha individual dentro de los selectores de Intro y Outro.
- La reproducción previa comparte un único canal de audio y detiene automáticamente la pista anterior.

### Identidad visual y aplicación de escritorio

- Creado e integrado un nuevo icono azul de Stream Radio con micrófono y ondas de emisión.
- Actualizada la integración del icono para la ventana de Electron, el instalador y los accesos directos de Windows.

### Validación

- Sintaxis validada en los módulos principales, renderer, preload e IPC.
- Pruebas de proveedores, handshake SHOUTcast y perfil FFmpeg ejecutadas correctamente.
- Smoke tests visuales de Electron ejecutados en escritorio y a 640 px de ancho.

### Notas de instalación

La construcción del instalador requiere los binarios locales de FFmpeg en `resources/ffmpeg/`. Estos binarios no se incluyen en el repositorio Git para evitar subir archivos pesados; el instalador generado por Electron Builder los incorpora desde el entorno de construcción.
