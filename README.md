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
5. **Efectos de sonido de interfaz.** Sintetizados con Web Audio API en tiempo real (sin
   archivos de audio externos, para no depender de licencias): sonido de click de navegación,
   tono de éxito, tono de inicio/fin de transmisión y tono de error. Implementado en
   `src/renderer/sound-fx.js` (`window.SoundFX`).
6. **Panel "en vivo" con contador.** Tarjeta destacada (hero) en la vista Estudio con indicador
   pulsante de estado y un reloj grande (`HH:MM:SS`) que corre mientras hay transmisión activa.
7. **Vúmetro y control de volumen.** Vúmetro segmentado tipo consola (verde/amarillo/rojo segun
   nivel) y control deslizante de ganancia, ambos en la vista Estudio.
8. **Biblioteca persistente y unificada de pistas.** Las pistas importadas se COPIAN dentro de
   la carpeta de datos de usuario de la app (`app.getPath('userData')/media-library/`), no se
   referencia solo la ruta original, para que sigan disponibles aunque el archivo original se
   mueva o se borre. La biblioteca es una sola lista (sin categoría fija de intro/outro a nivel
   de almacenamiento): cualquier pista puede usarse como intro, como outro, o como ambas. El
   diálogo de importación acepta selección múltiple de archivos en un solo paso. Implementado en
   `src/main/library-manager.js` + vista "Biblioteca" del renderer (importar, listar, eliminar).
   La vista "Configuración" elige, de esa misma lista, qué pista usar como intro activa y cuál
   como outro activo para la próxima transmisión (dos selectores independientes sobre el mismo
   catálogo).
9. **Navegación por secciones.** Barra lateral con 4 secciones: Estudio (dashboard principal),
   Biblioteca, Configuración, Información (about/versión de la app).
10. **Identidad visual UNIR Radio.** Paleta tomada directamente de `../../styles/UI.css` del
    sitio principal (no inventada): Rich Black `#03060f`, Navbar Blue `#13294B` / hover
    `#1d4179`, Gold `#fcc332`, Sky Blue `#6ea8fe`, texto `#e9edf5`. Tipografía Poppins (Google
    Fonts). Iconos de línea minimalista escritos a mano en `src/renderer/icons.js` (estilo
    Lucide/Feather) para no depender de un bundler en el renderer; se pueden reemplazar por
    `lucide-static` más adelante sin tocar el resto del código.

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
- [x] Verificar que la ventana abre correctamente en Windows con todo el motor conectado
      (`npm start`) — confirmado, sin errores en el log.

## Fase 1.5 — Entorno de build nativo (Windows) — RESUELTO

`naudiodon` ya compiló correctamente (`node_modules/naudiodon/build/Release/naudiodon.node`
​presente) y `electron-updater` quedó instalado. El bloqueo de Visual Studio Build
Tools/Windows SDK se resolvió.

- [x] Instalar/completar Visual Studio Build Tools con el Windows SDK.
- [x] Instalar `electron-updater`.
- [x] `naudiodon` compilado con exito (`naudiodon.node` generado).
- [x] Colocar `ffmpeg.exe` en `resources/ffmpeg/` — confirmado (`ffmpeg.exe`, `ffprobe.exe` y
      `ffplay.exe` ya están ahí).

### Sub-bloqueo: ABI mismatch de módulos nativos con Electron

Aunque `naudiodon` compiló bien contra el Node.js del SISTEMA, Electron trae su propio Node.js
interno con un ABI (`NODE_MODULE_VERSION`) distinto. El log lo mostró claro: el binario se
compiló con `NODE_MODULE_VERSION 127` pero Electron pide `148`. Esto es normal y esperado en
cualquier app Electron con módulos nativos — se soluciona con `@electron/rebuild`, que
recompila los módulos nativos específicamente contra el ABI de Electron.

- [x] Agregado `"postinstall": "electron-rebuild -f -w naudiodon"` en `package.json`, para que
      esto se resuelva solo en cada `npm install` futuro (por ejemplo, si alguien clona el repo
      en otra maquina).
- [x] `npm install --save-dev @electron/rebuild` corrido, rebuild disparado, `naudiodon` carga
      sin errores. **Fase 1.5 cerrada por completo.**

## Fase 2 — Motor de streaming (proceso principal) — IMPLEMENTADO

- [x] Módulo `ffmpeg-stream.js`: construye el comando ffmpeg equivalente al de la versión Python
      (entrada `s16le` por stdin, salida `mp3` a `icecast://user:pass@host:port/mount`,
      `-legacy_icecast 1`, `-content_type audio/mpeg`, metadatos `-ice_name` / `-ice_description`).
- [x] Manejo de proceso hijo con `child_process.spawn`, captura de `stderr` para log en tiempo
      real, con interpretación de errores conocidos (ver mas abajo).
- [x] Función de construcción de URL Icecast con codificación segura (`encodeURIComponent`) de
      usuario/contraseña/mount.
- [x] Módulo `media-probe.js`: obtener duración de intro/outro vía `ffmpeg -i` (parseo de
      `Duration: HH:MM:SS.xx`). En uso desde `library-manager.js` al importar pistas.
- [x] Reproducción de intro/outro con **ritmo real controlado por código**, no "lo mas rapido
      posible": se decodifica el archivo COMPLETO a PCM en memoria (`decodeToPcm`) y se escribe
      al stdin del encoder en trozos de 50ms via `playTimedPcm`, emitiendo
      `stream:intro-progress` / `stream:outro-progress` con tiempo real transcurrido. Esto era
      necesario para que el corte a -2s del outro sea preciso (no depende de la contrapresion
      de red, que no es predecible).
- [x] Corte diferido del outro: `playTimedPcm` acepta `cutoffSeconds` = duración - 2s; al
      alcanzarlo, deja de escribir y `stopStream` cierra la conexión real de inmediato.
- [x] Captura de audio en vivo con `naudiodon` (`audio-capture.js`) y escritura continua al
      stdin del encoder.
- [x] Control de ganancia en tiempo real (`applyGain` sobre cada buffer, ajustable en caliente
      desde el slider via el canal `stream:set-gain`, incluso con la transmisión activa).
- [x] Cálculo de nivel de pico/dB (`computePeakDb`) alimentando `stream:vu-level`.
- [x] Manejo de errores de conexión: `interpretFfmpegLine` reconoce 400/401/403/404 y
      `-10053`/`-10054`, agregando una línea de "Sugerencia" al log con el diagnóstico
      (ej. mountpoint/contraseña no coinciden con el panel de Zeno.fm).
- [x] Limpieza de emergencia (`shutdown()`) enganchada a `window-all-closed` / `before-quit` en
      `main.js`, para no dejar procesos `ffmpeg.exe` huérfanos si se cierra la app a mitad de
      una transmisión.
- [x] **Requisitos para probar con conexión real ya satisfechos** (Fase 6): `naudiodon`
      compilado y funcionando, `ffmpeg.exe` presente en `resources/ffmpeg/`. Solo falta la
      prueba en si contra Zeno.fm con credenciales reales.

## Fase 3 — Interfaz (renderer) — REDISEÑO COMPLETO

Rediseño total sobre el layout inicial de dos paneles: ahora es una app de navegación lateral
con 4 vistas, siguiendo las especificaciones funcionales #5-#10.

- [x] Barra de navegación lateral con 4 secciones: Estudio, Biblioteca, Configuración,
      Información (router simple por `data-view` / `data-view-panel`, sin dependencias).
- [x] Vista **Estudio**: hero "en vivo" con contador (`HH:MM:SS`) e indicador pulsante,
      vúmetro segmentado + control de ganancia, tarjetas de progreso de intro/outro, botones
      Iniciar/Detener, consola de log.
- [x] Vista **Configuración**: servidor, puerto, punto de montaje, usuario, contraseña, selector
      de dispositivo de entrada, y selectores independientes de "pista activa" de intro/outro,
      ambos alimentados desde la MISMA lista unificada de la Biblioteca. Implementados como un
      dropdown personalizado (`.track-picker`, no un `<select>` nativo) para poder mostrar el
      nombre Y la duración de cada pista con claridad antes de elegirla — un `<option>` nativo
      no admite ese tipo de formato.
- [x] Vista **Biblioteca**: catálogo único de pistas (sin columnas separadas de intro/outro),
      importación con selección múltiple de archivos en un solo diálogo, listado en grilla
      responsiva con duración, eliminar. Funcional de verdad, no es un stub.
- [x] Vista **Información**: nombre y versión de la app (leidos via IPC `app:info`), descripción,
      link al repositorio.
- [x] Barra/tarjeta de progreso de intro y outro (se muestran/ocultan via IPC
      `stream:intro-progress` / `stream:outro-progress`; el motor que las alimenta es Fase 2).
- [x] Consola de log con timestamps, con animación de entrada por linea.
- [x] Botones Iniciar/Detener con estados deshabilitados según corresponda.
- [x] Identidad visual UNIR Radio aplicada: paleta real del sitio (`--primary #13294B`,
      `--gold #fcc332`, `--sky-blue #6ea8fe`, fondo `--rich-black #03060f`), tipografía Poppins,
      iconos de linea, animaciones (fade de vistas, pulso del indicador "en vivo", shimmer en
      barras de progreso, hover en botones).
- [x] Efectos de sonido de interfaz (`sound-fx.js`) enganchados a: navegación, importar/eliminar
      pista, iniciar/detener transmisión, errores de validación.
- [x] Layout responsivo: la barra lateral se colapsa a solo iconos por debajo de 880px de ancho
      de ventana, y las grillas de Configuración/hero pasan a una columna por debajo de 680px.
      `minWidth` de la ventana bajado de 1050 a 640px en `main.js` para que el rango sea
      alcanzable de verdad.
- [x] Hero "en vivo" con estilo de panel digital: tipografía Orbitron para el contador
      (`--font-digital`), resplandor (`text-shadow`) en los dígitos, halo radial de fondo, y el
      indicador de estado como badge en pastilla con tinte de color según el estado
      (conectando/en vivo).
- [x] Confirmación al cerrar la ventana si hay una transmisión activa: dialogo nativo
      ("Cancelar" / "Detener y salir") en `main.js`, usando `ffmpegStream.isStreaming()`. Si el
      usuario confirma, se hace un corte de emergencia (sin outro) via `shutdown()`.
- [x] Verificar visualmente en Windows que el nuevo diseño renderiza bien — confirmado por el
      usuario, sin errores.

## Fase 4 — Comunicación IPC

- [x] Canales de streaming (implementados de verdad, Fase 2): `stream:start`, `stream:stop`,
      `stream:set-gain`, `stream:log`, `stream:status`, `stream:vu-level`,
      `stream:intro-progress`, `stream:outro-progress`, `devices:list`.
- [x] Canales de biblioteca (implementados de verdad): `library:list`, `library:import`
      (selección múltiple, sin argumentos), `library:delete` (recibe `id` directo).
- [x] Canal de info de la app: `app:info` (nombre + versión para la vista Información).
- [x] Listado de dispositivos de audio de entrada REALES: `devices:list` ahora llama a
      `audioCapture.listInputDevices()` (naudiodon). Devuelve `[]` con un aviso en el log si
      `naudiodon` no está disponible/compilado (ver Fase 1.5).

## Fase 5 — Empaquetado

- [x] Configurar `electron-builder` para generar instalador Windows (`.exe`, NSIS), con opciones
      profesionales: elegir carpeta de instalación, accesos directos de escritorio y menú
      inicio (`build.nsis` en `package.json`).
- [x] `ffmpeg.exe` incluido como recurso empaquetado (`extraResources` ya apunta a
      `resources/ffmpeg/`; `media-probe.js` resuelve la ruta distinto en dev vs. empaquetado via
      `app.isPackaged`).
- [ ] Agregar icono de marca (`resources/icon.ico`, 256x256) y referenciarlo en `build.win.icon`
      — opcional, mejora estética pendiente; sin él, el instalador usa el icono genérico de
      Electron.
- [ ] Probar instalador en una máquina limpia (sin Node/ffmpeg preinstalado) para validar que
      todo funcione de forma autónoma. Requiere correr `npm run dist` (Claude no puede ejecutar
      comandos en esta máquina).

## Fase 5.5 — Actualizaciones automáticas (GitHub) — CONFIGURADO

- [x] Repositorio confirmado y configurado en `build.publish` (`owner: jhersara`,
      `repo: Stream-Unirradio`).
- [x] `electron-updater` integrado en `auto-updater.js`: `checkForUpdatesAndNotify()` al
      arrancar, manejo de eventos (`update-available`, `update-downloaded`, `error`), y ahora
      también refleja el estado en la consola de actividad de la app (no solo en DevTools), via
      `sendLog`.
- [ ] Definir flujo de publicación: cada release en GitHub (tag + build subido a Releases) debe
      quedar disponible para que los clientes instalados lo detecten automáticamente. Con
      `GH_TOKEN` configurado como variable de entorno, `npm run dist -- --publish always` sube
      el build directo a un Release de GitHub.
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
    │   ├── main.js            # proceso principal, ciclo de vida de la app
    │   ├── ffmpeg-stream.js   # motor de streaming (implementado)
    │   ├── media-probe.js     # duración de audio via ffmpeg -i (implementado)
    │   ├── audio-capture.js   # captura de micrófono con naudiodon (implementado)
    │   ├── library-manager.js # biblioteca persistente y unificada de pistas (implementado)
    │   ├── ipc-events.js      # helpers centralizados para emitir eventos al renderer
    │   ├── ipc-handlers.js    # registro de canales IPC
    │   └── auto-updater.js    # electron-updater (Fase 5.5)
    ├── preload/
    │   └── preload.js         # contextBridge, superficie expuesta al renderer
    └── renderer/
        ├── index.html         # shell con sidebar + 4 vistas
        ├── renderer.js        # router de vistas, biblioteca, IPC, formato
        ├── styles.css         # paleta UNIR Radio, animaciones
        ├── icons.js           # set de iconos SVG de linea (window.renderIcon)
        └── sound-fx.js        # efectos de sonido sintetizados (window.SoundFX)
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
- La biblioteca de pistas se unificó (antes separaba `intros`/`outros` en el índice guardado).
  `library-manager.js` migra automáticamente el `library.json` viejo la primera vez que lo lee
  (no hace falta reimportar nada ni mover archivos a mano).
- **Aviso de trabajo concurrente:** durante la sesión que implementó la Fase 2 (motor de
  streaming), se detectó que `library-manager.js`, `preload.js`, `renderer.js`, `index.html` y
  `main.js` ya habían sido modificados por otra sesión/instancia (probablemente Claude Desktop
  abierto en paralelo) hacia el esquema unificado de biblioteca antes descrito, ademas de mejoras
  de layout responsivo y tipografía Orbitron para el contador. `ffmpeg-stream.js` e
  `ipc-handlers.js` se escribieron/ajustaron para calzar con ese esquema real (no con uno viejo
  asumido). **Si en el futuro algo no compila o una llamada IPC falla con "is not a function",
  lo primero a revisar es que las firmas entre `preload.js` ↔ `ipc-handlers.js` ↔
  `library-manager.js` / `ffmpeg-stream.js` sigan coincidiendo** — sesiones concurrentes pueden
  volver a desalinearlas.

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
