# Stream-Unirradio

Aplicación de escritorio (Electron) para transmitir audio en vivo hacia Zeno.fm / Icecast.
Migración del prototipo original en Python (CustomTkinter) a Electron, manteniendo la misma
lógica de conexión (ffmpeg + protocolo `icecast://` con `-legacy_icecast 1`) y añadiendo una
interfaz más flexible, reutilizando el sistema de marca de UNIR Radio (Poppins, paleta de
colores) definido en el proyecto principal (`../app`, `../styles`).

Este archivo funciona como checklist de gestión del proyecto. Se debe actualizar marcando cada
ítem `[x]` a medida que se complete, para llevar registro de avance entre sesiones.

---

## Especificaciones funcionales confirmadas

Estas son las reglas de negocio ya definidas por el usuario (no son sugerencias abiertas, son
requisitos a implementar):

1. **Audio fluido, sin cortes.** Captura de micrófono vía `naudiodon` (bindings de PortAudio)
   directamente en el proceso principal de Electron — el audio NUNCA pasa por IPC hacia el
   renderer. Esto evita la latencia/serialización extra que introduciría capturar con
   `getUserMedia` en el renderer y reenviar los buffers al proceso principal. Buffer/blockSize
   generoso para evitar underruns en la escritura al stdin de ffmpeg.
2. **Intro al iniciar transmisión.** Al presionar "Iniciar", se reproduce el archivo de intro
   completo a través del stream (igual que en la versión Python), pero ahora el panel debe
   mostrar una **barra de progreso de la intro** (tiempo transcurrido / duración total) para que
   el operador sepa cuándo termina. La duración se obtiene leyendo la salida de `ffmpeg -i
   <archivo>` (línea `Duration:`) antes de empezar a reproducirla.
3. **Outro al detener transmisión — corte diferido.** Al presionar "Detener", la transmisión
   **no se corta de inmediato**. En su lugar:
   - Se deja de capturar el micrófono en vivo.
   - Se empieza a reproducir el archivo de outro a través del mismo stream (mismo proceso
     ffmpeg, sin reconectar), con su propia barra de progreso en el panel.
   - Cuando falten **2 segundos** para que el outro termine (según su duración), en ese momento
     se cierra la conexión real hacia Icecast (se termina el proceso ffmpeg), incluso si al
     outro le quedan ~2s de audio local sin enviar.
4. **Actualizaciones automáticas vía GitHub.** La app debe usar `electron-updater` apuntando a
   los Releases de un repositorio de GitHub. Cada vez que se publique una nueva versión
   (release/tag) en GitHub, los clientes instalados deben detectarla y actualizarse solos.
   Repositorio confirmado: **https://github.com/jhersara/Stream-Unirradio** — ya configurado en
   `build.publish` de `package.json` (`owner: jhersara`, `repo: Stream-Unirradio`).

---

## Fase 0 — Planeación y arquitectura

- [x] Estrategia de captura de audio: **naudiodon** en el proceso principal (ver especificación
      funcional #1 arriba). Requiere Build Tools de Windows (Visual Studio Build Tools + Python)
      instalados en la máquina de desarrollo para compilar el módulo nativo vía node-gyp.
- [x] `ffmpeg.exe` (y su lectura de metadatos vía `-i`) se embebe como recurso de la app, no se
      depende de una instalación del sistema.
- [x] Estructura de carpetas definida (ver árbol más abajo).

## Fase 1 — Andamiaje del proyecto (scaffolding)

- [x] Inicializar proyecto Node (`package.json`) dentro de `Stream-Unirradio/`.
- [x] Instalar Electron y `electron-builder`, script de arranque (`electron .`) configurado.
- [x] Configurar proceso principal (`main.js`) con `BrowserWindow` básica.
- [x] Configurar `preload.js` con `contextBridge` para exponer solo las funciones necesarias al
      renderer (sin `nodeIntegration` directo, por seguridad).
- [ ] Verificar que la ventana abre correctamente en Windows (bloqueado por Fase 1.5 — falta
      `electron-updater`, ver abajo).

## Fase 1.5 — Entorno de build nativo (Windows) — EN CURSO

`npm install electron-updater naudiodon` falló porque `naudiodon` requiere compilar un módulo
nativo (`node-gyp`) y en esta máquina falta el **Windows SDK** dentro de Visual Studio Build
Tools (el log muestra VS2019 Build Tools instalado pero "missing any Windows SDK"). Como ambos
paquetes se instalaron en el mismo comando, `electron-updater` tampoco quedó instalado.

- [ ] Instalar/completar Visual Studio Build Tools con el workload "Desktop development with
      C++" (esto incluye el Windows SDK automáticamente):
      https://visualstudio.microsoft.com/visual-cpp-build-tools/
- [ ] Reiniciar la terminal (o la PC) después de instalar, para que las variables de entorno se
      refresquen.
- [ ] Instalar `electron-updater` por separado (no depende de compilación nativa, debería
      funcionar de inmediato): `npm install electron-updater`
- [ ] Reintentar `npm install naudiodon` por separado una vez esté el Windows SDK.
- [ ] Si `naudiodon` sigue sin compilar, evaluar alternativa de captura de audio como plan B
      (a decidir con el usuario, ver spec funcional #1).

## Fase 2 — Motor de streaming (proceso principal)

- [ ] Módulo `ffmpeg-stream.js`: construir el comando ffmpeg equivalente al de la versión Python
      (entrada `s16le` por stdin, salida `mp3` a `icecast://user:pass@host:port/mount`,
      `-legacy_icecast 1`, `-content_type audio/mpeg`, metadatos `-ice_name` / `-ice_description`).
- [ ] Manejo de proceso hijo con `child_process.spawn`, captura de `stderr` para log en tiempo
      real (igual que el `monitor_ffmpeg` de la versión Python).
- [ ] Función de construcción de URL Icecast con codificación segura de usuario/contraseña/mount.
- [ ] Módulo `media-probe.js`: obtener duración de intro/outro vía `ffmpeg -i` (parseo de
      `Duration: HH:MM:SS.xx`).
- [ ] Reproducción de intro: decodificar a PCM y encolar al stdin del encoder ANTES del audio en
      vivo, emitiendo progreso (`intro:progress`) por IPC en cada chunk escrito.
- [ ] Reproducción de outro con corte diferido: al detener, decodificar outro a PCM y encolarlo
      al stdin del encoder, emitiendo progreso (`outro:progress`) por IPC, y programar el cierre
      real del proceso ffmpeg/conexión Icecast exactamente 2 segundos antes del fin calculado
      del outro.
- [ ] Captura de audio en vivo (dispositivo de entrada seleccionado) y escritura continua al
      stdin del proceso ffmpeg de salida.
- [ ] Control de ganancia/volumen aplicado en tiempo real sobre el buffer de audio antes de
      enviarlo.
- [ ] Cálculo de nivel de pico/dB para alimentar el vúmetro del renderer vía IPC.
- [ ] Manejo de errores de conexión: reconocer patrones de fallo conocidos (400, 401, 403, 404,
      `-10053`/`-10054`) y emitir mensajes de diagnóstico claros (mountpoint/credenciales
      incorrectas, servidor caído, etc.) hacia el log del renderer.

## Fase 3 — Interfaz (renderer)

- [ ] Layout de dos paneles (Configuración / Estado y Monitor), igual estructura que la versión
      Python.
- [ ] Panel de configuración: servidor, puerto, punto de montaje, usuario, contraseña, selector
      de dispositivo de entrada, selección de archivos intro/outro.
- [ ] Panel de estado: indicador de conexión, temporizador de transmisión, vúmetro en tiempo
      real, control deslizante de ganancia.
- [ ] Barra de progreso de intro (visible al iniciar, se oculta cuando termina y arranca el vivo).
- [ ] Barra de progreso de outro (visible al detener, se oculta cuando se corta la conexión real).
- [ ] Consola de log con timestamps.
- [ ] Botones Iniciar/Detener con estados deshabilitados según corresponda (incluyendo el estado
      intermedio "reproduciendo outro" donde Detener ya no debería volver a dispararse dos veces).
- [ ] Aplicar identidad visual de UNIR Radio (tipografía Poppins, paleta de colores del proyecto
      principal) en lugar del tema genérico de CustomTkinter.
- [ ] Confirmación al cerrar la ventana si hay una transmisión (o un outro) activo.

## Fase 4 — Comunicación IPC

- [ ] Canales: `stream:start`, `stream:stop`, `stream:log`, `stream:status`, `stream:vu-level`,
      `stream:intro-progress`, `stream:outro-progress`, `devices:list`.
- [ ] Listado de dispositivos de audio de entrada disponibles, expuesto al renderer al arrancar.

## Fase 5 — Empaquetado

- [ ] Configurar `electron-builder` para generar instalador Windows (`.exe`, NSIS).
- [ ] Incluir binario de `ffmpeg.exe` como recurso empaquetado (`extraResources`).
- [ ] Probar instalador en una máquina limpia (sin Node/ffmpeg preinstalado) para validar que
      todo funcione de forma autónoma.

## Fase 5.5 — Actualizaciones automáticas (GitHub)

- [ ] Confirmar owner/nombre del repositorio de GitHub (dato pendiente del usuario) y actualizar
      `build.publish` en `package.json`.
- [ ] Integrar `electron-updater` en el proceso principal: `checkForUpdatesAndNotify()` al
      arrancar, y manejo de eventos (`update-available`, `update-downloaded`, errores).
- [ ] Definir flujo de publicación: cada release en GitHub (tag + build subido a Releases) debe
      quedar disponible para que los clientes instalados lo detecten automáticamente.
- [ ] Nota: en Windows, un instalador sin firma de código puede generar advertencias de
      SmartScreen y, dependiendo de la configuración, complicar el auto-update silencioso.
      Evaluar más adelante si se requiere certificado de firma de código.

## Fase 6 — Pruebas de conexión real

- [ ] Prueba de conexión contra Zeno.fm con credenciales reales.
- [ ] Prueba de intro/outro con archivos reales, verificando que las barras de progreso reflejen
      el tiempo real y que el corte tras el outro ocurra exactamente 2s antes de su fin.
- [ ] Prueba de estabilidad: transmisión sostenida por al menos 30-60 minutos sin cortes.

---

## Estructura de carpetas

```
Stream-Unirradio/
├── README.md
├── package.json
├── resources/
│   └── ffmpeg/          # ffmpeg.exe (y build correspondiente) para empaquetar con la app
└── src/
    ├── main/
    │   ├── main.js          # proceso principal, ciclo de vida de la app
    │   ├── ffmpeg-stream.js # motor de streaming (Fase 2)
    │   ├── media-probe.js   # duración de intro/outro (Fase 2)
    │   ├── audio-capture.js # captura de micrófono con naudiodon (Fase 2)
    │   ├── ipc-handlers.js  # registro de canales IPC (Fase 4)
    │   └── auto-updater.js  # electron-updater (Fase 5.5)
    ├── preload/
    │   └── preload.js       # contextBridge, superficie expuesta al renderer
    └── renderer/
        ├── index.html
        ├── renderer.js
        └── styles.css
```

## Notas de contexto (para continuidad entre sesiones)

- El prototipo original en Python está resuelto y funcional: usa `icecast://` (no `http://`) con
  `-legacy_icecast 1` para evitar el error 400 de Zeno.fm.
- El error `-10053` (conexión abortada por el servidor) se debía a un punto de montaje que no
  coincidía exactamente con el configurado en el panel de Zeno.fm — siempre copiar los valores
  directamente del panel, no retipearlos.
- No modificar nada fuera de `Stream-Unirradio/`; el resto de `uniradio/` es el sitio Next.js de
  UNIR Radio y debe permanecer intacto.
- Repositorio de GitHub del proyecto: https://github.com/jhersara/Stream-Unirradio (ya
  configurado en `package.json`).
- Bloqueo activo: falta el Windows SDK para compilar `naudiodon` (ver Fase 1.5).

## Control de versiones

Cada cambio relevante debe quedar versionado en git y subido a
https://github.com/jhersara/Stream-Unirradio. Claude no puede ejecutar comandos en esta
máquina (solo crear/editar archivos), así que después de cada tanda de cambios se debe:

1. Revisar/actualizar la `"version"` en `package.json` si el cambio amerita un nuevo release
   (sigue semver: parche `0.1.x` para fixes, menor `0.x.0` para features nuevas).
2. Correr en la terminal, dentro de `Stream-Unirradio/`:
   ```
   git add .
   git commit -m "mensaje descriptivo del cambio"
   git push
   ```
3. Si el cambio corresponde a una nueva versión publicada (release) para que
   `electron-updater` la detecte, además: `git tag vX.Y.Z && git push --tags`, y subir el build
   generado por `npm run dist` a un Release de GitHub (o configurar CI para que lo haga).

Este README se actualizará en cada sesión marcando los ítems completados, para que cualquier
continuación futura sepa exactamente en qué punto quedó el proyecto.
