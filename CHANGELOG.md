# Historial de cambios

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
