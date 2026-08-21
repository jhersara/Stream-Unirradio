# Stream-Unirradio

Aplicación de escritorio (Electron) para transmitir audio en vivo hacia Zeno.fm, Centova Cast Icecast y Centova Cast SHOUTcast.
Migración del prototipo original en Python (CustomTkinter) a Electron, manteniendo la misma
lógica de conexión Icecast (FFmpeg + protocolo `icecast://` con `-legacy_icecast 1`) y añadiendo una
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
10. **Identidad visual: estilo Visual Studio Code (Dark+) con acentos UNIR Radio.** A pedido
    explícito del usuario, se reemplazó el tema "SaaS card" (paleta completa del sitio +
    Poppins + Orbitron) por la estética estructural de VS Code: activity bar de 48px solo-
    iconos, barra de estado inferior, paneles planos de esquinas rectas, fuente del sistema
    (`Segoe UI` / `-apple-system`, sin Google Fonts). El acento de color (originalmente el navy
    `#13294B` / gold `#fcc332` de UNIR Radio) se maneja como variables CSS reemplazables sobre
    esa misma estructura — y de hecho se reemplazó por completo en la Fase 8 (violeta/magenta),
    sin tocar el layout. Iconos de línea minimalista escritos a mano en `src/renderer/icons.js`
    (estilo Lucide/Feather), sin cambios.

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

### Correcciones post-prueba real (confirmadas por el usuario transmitiendo)

Primera tanda de problemas reportados tras la primera transmisión real:

1. **Bucle de 3-6s repitiendose al final de cada transmisión.** Causa: `teardownSession`
   cerraba `stdin` (EOF) y llamaba `proc.kill()` casi al mismo tiempo, sin darle tiempo a ffmpeg
   de vaciar el encoder ni cerrar la conexión TCP hacia Icecast de forma limpia. Zeno.fm
   interpretaba ese corte abrupto quedándose con el último fragmento en su buffer y
   repitiéndolo para los oyentes hasta detectar que la fuente ya no respondía. **Fix:** ahora se
   cierra `stdin` y se espera (hasta 2.5s) a que ffmpeg termine solo -> eso sí manda un cierre de
   conexión correcto; solo se fuerza `kill()` si no sale a tiempo.
2. **Eco/repetición de voz y audio durante la transmisión en vivo (aparte del delay normal).**
   Causa más probable: se mandaba un evento IPC (`stream:vu-level`) en CADA callback de audio de
   `naudiodon` (decenas de veces por segundo), compitiendo por el mismo hilo de JS que debe
   seguir escribiendo al pipe de ffmpeg a tiempo real; si ese hilo se atrasaba, `naudiodon` podía
   reenviar/repetir audio de su buffer interno para compensar. **Fix:** el envío de nivel de
   vumetro se limitó a ~15 veces/seg en vez de en cada callback.

### Segunda tanda de correcciones (tras probar de nuevo)

El usuario reportó tres problemas mas especificos despues de la primera ronda de fixes:

3. **Retraso de 10-12s entre "Iniciar" y que los oyentes escuchen algo — el intro casi no se
   alcanza a oir.** Diagnóstico: esto **no es un bug de la app**. Coincide con el mismo patrón
   de buffering/switchover de Zeno.fm ya documentado antes (ver Notas de contexto): la
   plataforma tarda varios segundos en detectar la fuente en vivo y cortar su programación
   automática/AutoDJ para pasar a ella. No es corregible desde el código del source client.
   **Workaround operativo:** dejar unos segundos de "colchón" (silencio o musica) al principio
   del intro antes del contenido importante, para que la voz no se pierda en la ventana de
   switchover.
4. **"Se cortaba por partes" durante el outro (audio entrecortado, con huecos).** Causa real:
   `playTimedPcm` mandaba un chunk de tamaño FIJO cada `CHUNK_MS` (50ms) via `setTimeout`, pero
   `setTimeout` en Node no garantiza precision — si el event loop se congestionaba un momento
   (decode de audio, IPC, GC), un tick llegaba tarde y el encoder se quedaba sin datos durante
   ese hueco real. **Fix:** reescrito para calcular cuantos bytes enviar segun el TIEMPO REAL
   transcurrido (no un contador de ticks); si un tick se atrasa, el siguiente manda un chunk mas
   grande para ponerse al dia, sin dejar huecos.
5. **El "hola" (audio en vivo) se repitió justo al cortar, antes de que empezara el outro.**
   Causa: en `stopStream`, la fase de la sesión (`session.phase`) solo cambiaba de `'live'` a
   `'outro'` DESPUES de terminar de decodificar el archivo de outro — durante esa ventana,
   `session.phase` seguia siendo `'live'`, asi que si `naudiodon` entregaba un ultimo bloque de
   audio duplicado al cerrar el stream (comportamiento conocido de algunos bindings nativos de
   audio al hacer `.quit()`), ese bloque igual se escribia al encoder. **Fix:** la fase cambia a
   `'outro'` ANTES de llamar `inputStream.quit()`, asi el guard del handler de audio bloquea
   cualquier callback tardio de inmediato.
6. **~5s de silencio en la programación de Zeno al volver del corte.** Este es comportamiento
   del lado de Zeno (su AutoDJ tarda en detectar que la fuente se desconectó y retomar), no
   controlable desde aca; debería mejorar algo con el fix #1 de la primera tanda (cierre
   limpio) pero seguramente no desaparezca del todo — es la contraparte del mismo mecanismo de
   switchover del punto 3.
7. **Optimización adicional:** intro y outro ahora se pre-decodifican a PCM EN PARALELO (intro:
   mientras se confirma la conexión; outro: durante toda la sesión en vivo) en vez de
   decodificarse en el momento en que hacen falta. Esto reduce aun mas el hueco de silencio
   entre "el vivo termina" y "el outro empieza a sonar".
- [ ] **Pendiente de confirmar por el usuario** que los puntos 4 y 5 (los dos corregibles desde
      el código) ya no ocurren en una prueba real.

### Configuración persistida (credenciales, dispositivo, pistas activas)

A pedido del usuario: todos los campos de Configuración (servidor, puerto, mountpoint, usuario,
dispositivo de entrada, intro/outro activos, ganancia) se guardan solos cada vez que cambian, y
se restauran automáticamente al abrir la app — ya no hay que volver a escribirlos cada sesión.

- [x] Nuevo módulo `src/main/settings-store.js`: guarda `settings.json` en
      `app.getPath('userData')`. La contraseña se cifra por separado con `safeStorage` (DPAPI en
      Windows) antes de guardarse — no queda en texto plano en el archivo.
- [x] Canales IPC `settings:load` / `settings:save` (`ipc-handlers.js`, `preload.js`).
- [x] `renderer.js`: `applySettings()` al arrancar (después de cargar la biblioteca, para que
      los pickers de intro/outro puedan marcar la pista guardada), `persistSettings()` en cada
      cambio de campo relevante (`change` en inputs/selects/checkboxes, selección en los
      pickers, `change` del slider de ganancia).

## Fase 3 — Interfaz (renderer) — REDISEÑO COMPLETO

Rediseño total sobre el layout inicial de dos paneles: ahora es una app de navegación lateral
con 4 vistas, siguiendo las especificaciones funcionales #5-#10.

- [x] **Activity bar** (estilo VS Code) con 4 secciones: Estudio, Biblioteca, Configuración,
      Información. 48px, solo iconos con tooltip (`title=`), indicador de sección activa como
      barra vertical dorada de 2px en el borde izquierdo del icono (mismo patrón que el borde
      activo de VS Code). Router simple por `data-view` / `data-view-panel`, sin dependencias.
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
- [x] Identidad visual: paleta neutra de VS Code Dark+ (`--bg-editor #1e1e1e`, `--bg-elevated
      #252526`, `--bg-activitybar #333333`) con `--primary #13294B` / `--gold #fcc332` de UNIR
      Radio como acento; fuente del sistema (`Segoe UI`) en vez de Poppins; iconos de línea sin
      cambios. Ver especificación funcional #10 para el detalle completo de la decisión.
- [x] Efectos de sonido de interfaz (`sound-fx.js`) enganchados a: navegación, importar/eliminar
      pista, iniciar/detener transmisión, errores de validación.
- [x] Layout responsivo: la activity bar ya es fija en 48px solo-iconos (no necesita colapsar,
      a diferencia de la barra lateral con texto de la iteración anterior), y las grillas de
      Configuración/hero pasan a una columna por debajo de 680px. `minWidth` de la ventana
      (640px, `main.js`) sigue vigente sin cambios.
- [x] Panel "en vivo" replanteado en estilo VS Code (reemplaza el hero de panel digital con
      Orbitron/resplandor de la iteración anterior, ya no vigente): plano, esquinas rectas,
      contador en `Consolas` sin efectos. El estado (punto + texto) ahora se refleja además,
      siempre visible sin importar la vista activa, en la nueva **barra de estado** inferior.
- [x] **Barra de estado** (nueva, estilo VS Code): franja de 22px al pie de toda la ventana —
      punto + texto de conexión a la izquierda; ganancia, contador `HH:MM:SS` y versión de la
      app a la derecha. Fondo `--primary` por defecto, cambia a rojo (`#a1260d`, mismo tono que
      VS Code usa para su barra de estado en modo debug) mientras hay transmisión en vivo o
      error. Los campos de ganancia/versión se ocultan por debajo de 680px de ancho.
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
- [x] Agregar icono de marca (`resources/icon.ico`, 256x256) y referenciarlo en `build.win.icon`
      — **hecho.** El usuario proporciono el logo (letra "R" dorada sobre fondo negro con ondas
      de señal), se convirtio a `.ico` multi-resolucion (16 a 256px, con transparencia real en
      las esquinas) y se referencio en `build.win.icon`, `build.nsis.installerIcon`,
      `build.nsis.uninstallerIcon`, y en el icono de la `BrowserWindow` (`main.js`) para que se
      vea correcto tambien corriendo con `npm start`, no solo en el instalador empaquetado.
- [ ] Probar instalador en una máquina limpia (sin Node/ffmpeg preinstalado) para validar que
      todo funcione de forma autónoma. Requiere correr `npm run dist` (Claude no puede ejecutar
      comandos en esta máquina). **Instalador ya generado** (`dist\Stream Radio Setup 0.5.0.exe`
      + `latest.yml` + `.blockmap`, listos para GitHub Releases) — falta instalarlo de verdad y
      confirmar que la app empaquetada encuentra `ffmpeg.exe` y `naudiodon` correctamente (las
      rutas de recursos son distintas en modo dev vs. empaquetado).

## Fase 5.5 — Actualizaciones automáticas (GitHub) — CÓDIGO COMPLETO, FALTA PUBLICAR

- [x] Repositorio confirmado y configurado en `build.publish` (`owner: jhersara`,
      `repo: Stream-Unirradio`).
- [x] `electron-updater` integrado en `auto-updater.js`: `checkForUpdatesAndNotify()` al
      arrancar (solo si `app.isPackaged`, para no ensuciar el log en modo desarrollo con un
      error esperado por falta de `app-update.yml`), manejo de eventos (`update-available`,
      `update-downloaded`, `update-not-available`, `error`), reflejado en la consola de
      actividad de la app via `sendLog` (no solo en DevTools).
- [x] **Botón manual "Buscar actualizaciones"** en la vista Información: canal IPC
      `updates:check` (`ipc-handlers.js` → `auto-updater.js#checkNow`), expuesto en
      `preload.js` como `checkForUpdates()`. Sirve tanto para que el usuario compruebe a mano
      si hay version nueva, como para probar el flujo completo sin esperar al arranque.
- [x] **Único paso que falta — es operativo, no de código:** publicar un Release en GitHub con
      el instalador + `latest.yml` + `.blockmap` (ya generados en `dist/` tras `npm run dist`).
      Con `GH_TOKEN` configurado como variable de entorno, `npm run dist:publish` (script
      dedicado que evita el problema de npm comiéndose el flag `--publish` cuando se pasa via
      `npm run dist -- --publish always`) construye Y sube todo junto a un Release. **v0.6.0 ya
      publicado exitosamente** (build firmado con signtool.exe, subido a GitHub Releases como
      borrador — falta que el usuario le de "Publish release" en GitHub.com para que quede
      visible/detectable).
- [x] Para confirmar que el ciclo completo funciona de verdad: publicar un release con la
      version ACTUAL primero (deja a los futuros clientes con una linea base), despues subir la
      version en `package.json`, volver a construir y publicar, y verificar que una instalacion
      con la version anterior lo detecta sola (o via el boton manual) y lo descarga. **Confirmado
      por el usuario: el ciclo completo de auto-update funciona.** Fase 5.5 cerrada.
- [ ] Nota: en Windows, un instalador sin firma de código puede generar advertencias de
      SmartScreen y, dependiendo de la configuración, complicar el auto-update silencioso.
      Evaluar más adelante si se requiere certificado de firma de código.

## Fase 6 — Pruebas de conexión real

- [x] Prueba de conexión contra Zeno.fm con credenciales reales — confirmado, transmite bien.
- [x] Prueba de intro/outro con archivos reales — confirmado tras las correcciones de la
      Fase 2 (ver "Segunda tanda de correcciones" arriba); ritmo real, sin cortes, corte del
      outro a -2s preciso.
- [ ] Prueba de estabilidad: transmisión sostenida por al menos 30-60 minutos sin cortes —
      pendiente.

## Fase 7 — Ronda grande de mejoras (interfaz + funcionalidades nuevas)

A pedido explícito del usuario, tras un brainstorm de mejoras de interfaz y nuevas
funcionalidades. De la lista completa propuesta, esta ronda implementó lo que estaba mejor
especificado y se integraba naturalmente entre sí; el resto queda para la siguiente (ver
"Pendiente para la próxima ronda" al final de esta fase).

- [x] **Bug de producción corregido: se abrían dos ventanas de la app al iniciar.** Causa: no
      había bloqueo de instancia única en Electron. Cualquier doble-arranque (doble clic
      accidental, el instalador reabriendo tras "Ejecutar ahora", etc.) creaba una SEGUNDA
      `BrowserWindow` completa en vez de simplemente enfocar la que ya estaba abierta. **Fix:**
      `app.requestSingleInstanceLock()` en `main.js` — si ya hay una instancia corriendo, la
      nueva se cierra sola y en su lugar se enfoca/restaura la existente (evento
      `second-instance`).
- [x] **Prueba de micrófono sin transmitir** ("estado de señal"). Nuevo botón "Probar
      micrófono" en Configuración, junto al selector de dispositivo, con su propio mini-vúmetro
      segmentado. Usa `naudiodon` para escuchar el dispositivo elegido SIN conectar a Icecast ni
      escribir a ningún lado (`ffmpeg-stream.js#startPreview/stopPreview`, canales
      `stream:preview-start` / `stream:preview-stop`, evento `stream:preview-vu-level`). Se
      detiene sola al salir de la vista Configuración o al iniciar una transmisión real (no
      pueden compartir el mismo dispositivo a la vez).
- [x] **Grabación local con confirmación Sí/No al iniciar.** Al darle "Iniciar Transmisión",
      aparece un modal preguntando si se quiere guardar también un archivo local (mp3) de la
      sesión. Si dice "No" arranca la transmisión normal; si dice "Sí", además de transmitir a
      Zeno se abre un SEGUNDO proceso ffmpeg que recibe el mismo audio (intro + vivo + outro,
      via `writeToOutputs()`) y lo codifica a un archivo local en
      `Documentos/Stream Radio - Grabaciones/transmision-YYYY-MM-DD_HH-mm-ss.mp3`. Un fallo en
      la grabación local NUNCA interrumpe la transmisión en vivo (proceso independiente, errores
      capturados aparte). El cierre del proceso grabador usa el mismo patrón de cierre ordenado
      (`gracefullyEndProcess`) que ya se usaba para el encoder, para no dejar el mp3 truncado.
- [x] **Historial de transmisiones.** Nueva sección en la barra lateral. Cada vez que una
      sesión termina (manual, por error, o porque se cerró la app a mitad de transmisión) se
      guarda una entrada en `history.json` (`src/main/history-store.js`, máximo 200 entradas)
      con fecha, duración, servidor/mount, y la ruta de la grabación si se guardó una. La vista
      lista las sesiones más recientes primero, con un botón "Abrir carpeta" (`shell.
      showItemInFolder`) para las que tienen grabación.
- [x] **Popup de actualización + insignia persistente + reinicio con un clic.** Cuando
      `electron-updater` detecta una versión nueva, aparece un modal informativo; si el usuario
      lo cierra sin actuar, queda una insignia dorada pulsante al pie de la barra de actividad
      (mismo patrón que usa la app de escritorio de Claude) que no desaparece hasta que se
      resuelva. Cuando la descarga termina, el modal se vuelve a mostrar solo (y la insignia
      cambia de texto) ofreciendo un botón "Reiniciar app" que llama a
      `autoUpdater.quitAndInstall()` de inmediato, sin esperar a que el usuario cierre la app por
      su cuenta. Estado estructurado nuevo: evento `app:update-state` (`ipc-events.js`), UI en
      `renderer.js` (`openUpdateModal`, `showUpdateBadge`).

### Bug encontrado al probar: el modal tapaba toda la app desde el arranque

Al primer `npm start` despues de esta ronda, el modal generico (vacio, sin texto ni botones)
aparecia sobre la interfaz e impedia interactuar con nada, incluso sin haber disparado ningun
aviso de actualizacion ni el prompt de grabacion. Causa: en CSS, `.modal-overlay { display:
flex; }` y la regla por defecto del navegador `[hidden] { display: none; }` tienen la MISMA
especificidad (una clase vs. un atributo); cuando eso pasa, gana la regla que aparece mas abajo
en la cascada, y como `styles.css` se carga despues de la hoja de estilos del navegador, mi
`display: flex` ganaba SIEMPRE, sin importar si el atributo `hidden` estaba puesto o no. El
modal quedaba siempre visible (y vacio, porque `showModal()` nunca se habia llamado todavia).
**Fix:** se agrego `.modal-overlay[hidden] { display: none; }`, que al ser un selector con
mayor especificidad (clase + atributo) siempre gana, sin depender del orden en el archivo.

### Pendiente para la próxima ronda (ya priorizado, no implementado todavía)

Mejoras de interfaz:
- [x] Ecualizador de espectro — FFT propia (radix-2 Cooley-Tukey, sin dependencia nueva),
      24 bandas logaritmicas, calculado en el MISMO bloque throttled que ya usaba el vumetro
      (~15/seg) para no repetir el bug del eco. Canal `stream:spectrum`.
- [x] Vista previa de audio en Biblioteca — boton de play por pista, usando un `<audio>`
      compartido en el renderer alimentado por una data URL base64 (`library:get-audio`,
      `library-manager.js#getTrackAudioDataUrl`).
- [x] Modo mini-ventana flotante — boton en la barra de estado; reduce la MISMA ventana a
      300x130px, `setAlwaysOnTop('floating')`, y cambia a una barra compacta dedicada
      (`#compact-bar`) con estado + contador + boton de detener, en vez de esconder partes de
      la UI grande con CSS.
- [x] Barra de progreso de descarga de actualizaciones — vista Información, panel
      "Actualizaciones". El evento `download-progress` de `electron-updater` no estaba
      conectado; ahora dispara un nuevo estado `downloading` en `app:update-state` (porcentaje,
      bytes transferidos/total, velocidad). Barra visual reutiliza `.progress-track`/
      `.progress-fill` (mismos estilos que intro/outro), con el porcentaje y MB descargados/
      total como texto al lado; la insignia de la barra de actividad tambien refleja el
      porcentaje en vivo en su tooltip mientras descarga.

Funcionalidades nuevas (implementadas en la Fase 9, ver abajo):
- [x] Reconexión automática si se cae la conexión con Zeno (reintentos con espera creciente).
- [x] Detección de "aire muerto" (alerta si no hay señal de audio real por X segundos durante
      una transmisión en vivo).
- [x] Programación por horario (inicio/fin automático sin intervención manual).

## Fase 8 — Rebrand: nuevo icono + paleta violeta/magenta

A pedido del usuario, reemplazo completo de identidad visual (el icono UNIR Radio y la paleta
navy/gold quedaron atras).

- [x] **Icono nuevo**: el usuario proporciono el arte (perilla/dial negro con anillos de señal,
      sobre fondo degradado violeta->magenta). Se recorto al bounding box del icono (incluida la
      antena), se centro en lienzo cuadrado 1024x1024, y se genero `resources/icon.ico`
      multi-resolucion (16-256px), reemplazando el icono anterior en el mismo archivo (no hizo
      falta tocar `package.json`, ya apuntaba ahi).
- [x] **Paleta nueva** aplicada en todo `styles.css`, sobre la guia de marca que dio el usuario
      (violeta `#8a4dff`, magenta `#ff4dcc`, gradiente 135°, lavanda `#e9d6ff`, negro profundo
      `#0d0d0d`, grises `#1a1a1a`/`#2e2e2e`/`#5a5a5a`/`#f2f2f2`):
  - Botones principales, timer "en vivo", indicador activo de navegacion, barras de progreso,
    insignia de actualizacion, modal: gradiente violeta->magenta (`--gradient-brand`), varios
    con texto en gradiente (`background-clip: text`) para un efecto de brillo mas "moderno".
  - **Decision de diseño deliberada**: los colores SEMANTICOS del vumetro (verde=bien,
    ambar=cuidado, rojo=saturando) y de los botones de peligro/detener se dejaron FUERA del
    rebrand de marca (`--success`, `--caution`, `--danger` siguen siendo verde/ambar/rojo, no
    violeta/magenta) porque son convenciones universales de medicion de audio que un operador
    necesita reconocer al instante; mezclarlas con el color de marca reduciria la legibilidad
    funcional del vumetro.
  - Radio de bordes subido de 3px a 6px (paneles) para un aspecto mas suave/moderno, acorde a
    las esquinas redondeadas del propio icono nuevo.
- [ ] **Pendiente de confirmar por el usuario** que el nuevo icono se ve bien una vez guardado
      en `resources/icon.ico` y que la paleta nueva le gusta en la app real (esto se hizo sin
      poder probarlo visualmente en vivo).

## Fase 9 — Reconexión automática, aire muerto, y programación por horario

Las 3 funcionalidades grandes que habían quedado pendientes de la Fase 7, todas tocando
directamente el motor de streaming (`ffmpeg-stream.js`).

- [x] **Reconexión automática.** Si el proceso encoder muere sin que el usuario haya pedido
      detener (`session.stopRequested === false`) mientras la fase es `'live'` o `'intro'`, en
      vez de cortar la transmisión de inmediato se llama a `attemptReconnect()`: reintenta con
      espera creciente (`3s, 6s, 12s, 24s, 30s` — 5 intentos) reconstruyendo un encoder nuevo
      con la MISMA config. Durante los reintentos, la captura de microfono (`naudiodon`) y la
      grabación local NO se detienen — solo se quedan momentaneamente sin encoder al que
      escribir (`writeToEncoder` ya es seguro con un proceso nulo/muerto), asi que no hay que
      reabrir el dispositivo de audio ni cortar una grabacion en curso por un corte breve. Si
      los 5 intentos fallan, recien ahi se corta de verdad (`handleUnexpectedTermination`).
      Nuevo estado de UI `reconnecting` (punto/texto "Reconectando..." en el hero y la barra de
      estado). El usuario puede cancelar en cualquier momento con Detener, incluso a mitad de un
      reintento.
  - **Alcance deliberado**: NO se reconecta si el corte pasa durante la fase `outro` (ya se
    esta terminando la transmision a proposito; reanudar el outro desde donde quedo agregaria
    bastante complejidad para un caso borde raro dado lo corto que suele ser un outro).
- [x] **Detección de "aire muerto".** Dentro del mismo bloque throttled (~15/seg) que ya
      calculaba el vumetro, se rastrea cuanto tiempo lleva el nivel de pico por debajo de un
      umbral de silencio (`SILENCE_PEAK_THRESHOLD = 0.02`, ~-34dB) de forma continua. Pasados
      `DEAD_AIR_SECONDS = 15` segundos, se dispara UNA alerta (log + evento `stream:dead-air`
      con `active: true`) — no se repite en cada chequeo. Se limpia sola (con aviso de
      "recuperado") en cuanto vuelve a haber señal. En el renderer, un banner rojo aparece
      arriba del panel del vumetro en la vista Estudio (`#dead-air-banner`) mas un sonido de
      error una sola vez.
- [x] **Programación por horario.** Nuevos modulos `schedule-store.js` (persistencia,
      `schedule.json`) y `scheduler.js` (logica de disparo). El scheduler usa SONDEO periodico
      (`setInterval` cada 20s), no un `setTimeout` de larga duracion calculado una sola vez —
      mas robusto ante suspension del equipo, cambios de hora del sistema, etc.: en cada
      chequeo compara la hora actual contra `startTime`/`stopTime` configurados, valida que hoy
      sea uno de los `days` activos, y evita disparar la MISMA accion dos veces el mismo dia via
      una clave `accion-YYYY-MM-DD`. Al iniciar automáticamente usa la ULTIMA configuracion
      guardada en `settings-store.js` (la misma que se ve en Configuracion) con
      `recordSession` tomado del checkbox "Grabar automaticamente" del horario (no se puede
      mostrar el modal de confirmacion Si/No porque nadie esta ahi para responderlo). Nueva
      seccion en la vista Configuracion: activar/desactivar, hora de inicio, hora de fin,
      selector de dias (7 botones toggle, L-D), y el checkbox de grabacion automatica. Todo se
      persiste solo en cada cambio (`persistSchedule()`), igual patron que `persistSettings()`.
- [ ] **Pendiente de confirmar por el usuario**: probar los 3 en condiciones reales (cortar el
      internet a mitad de una transmision para ver la reconexion, silenciar el microfono 15s
      para ver la alerta de aire muerto, y dejar una programacion armada para el dia siguiente).
      Ninguno de los 3 se pudo probar en vivo durante la implementacion.

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
    │   ├── main.js            # proceso principal, ciclo de vida de la app, instancia unica
    │   ├── ffmpeg-stream.js   # motor de streaming, grabacion local, prueba de microfono,
    │   │                      # reconexion automatica, deteccion de aire muerto
    │   ├── media-probe.js     # duración de audio via ffmpeg -i (implementado)
    │   ├── audio-capture.js   # captura de micrófono con naudiodon (implementado)
    │   ├── library-manager.js # biblioteca persistente y unificada de pistas (implementado)
    │   ├── history-store.js   # historial de transmisiones (implementado)
    │   ├── settings-store.js  # configuracion persistida, password cifrada con safeStorage
    │   ├── schedule-store.js  # persistencia de la programacion por horario
    │   ├── scheduler.js       # sondeo periodico que dispara inicio/fin programados
    │   ├── ipc-events.js      # helpers centralizados para emitir eventos al renderer
    │   ├── ipc-handlers.js    # registro de canales IPC
    │   └── auto-updater.js    # electron-updater + estado estructurado para popup/insignia
    ├── preload/
    │   └── preload.js         # contextBridge, superficie expuesta al renderer
    └── renderer/
        ├── index.html         # shell con sidebar + 4 vistas
        ├── renderer.js        # router de vistas, biblioteca, IPC, formato
        ├── styles.css         # estilo VS Code Dark+ con acentos UNIR Radio
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
- El estilo visual pasó de "SaaS card" (Poppins + paleta completa del sitio + Orbitron) a
  estilo VS Code (ver especificación funcional #10) a pedido explícito del usuario. La CSP de
  `index.html` se simplificó porque ya no se cargan fuentes externas de Google Fonts.
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


## Fase 10 — Modernización UI/UX azul y actualizaciones visibles — IMPLEMENTADA

- [x] Rediseño editorial inspirado en Alixdemy, adaptado a una aplicación de escritorio de radio.
- [x] Cambio de identidad visual a azul profundo, azul eléctrico y cian, conservando verde/ámbar/rojo para la semántica del audio.
- [x] Navegación lateral modernizada con marca Stream Radio, etiquetas contextuales, descripciones de cada vista y estado de actualización visible.
- [x] Dashboard de Estudio actualizado con hero de emisión, contexto de sesión, monitor de señal, contador y actividad operativa.
- [x] Vúmetro y analizador de espectro actualizados con escala, leyenda de señal, calidad de entrada, gradiente azul/cian y soporte de movimiento reducido.
- [x] Vistas de Biblioteca, Historial, Configuración e Información actualizadas con bloques editoriales y jerarquía más clara.
- [x] Flujo de actualizaciones actualizado: comprobando, descargando con porcentaje y velocidad, lista para instalar y botón "Reiniciar para instalar".
- [x] Insignia persistente en la navegación cuando hay una actualización disponible, en descarga o lista para instalar.
- [x] Los errores del actualizador ahora se envían también al renderer como estado estructurado y se muestran en la vista Información.
- [x] Validación de sintaxis de `renderer.js` y `auto-updater.js` completada; la app abre en modo desarrollo sin errores de arranque visibles.

La modernización no modifica el flujo de audio ni envía buffers por IPC. La ampliación futura de métricas RMS, pico hold y canales L/R queda preparada como siguiente mejora del motor de audio.


### Mejora visual adicional — Vúmetro y ecualizador en tiempo real

- [x] El vúmetro ahora utiliza un motor visual único basado en `requestAnimationFrame`, con ataque rápido y caída suave para evitar saltos entre eventos IPC.
- [x] Se añadió retención temporal del pico máximo, con marcador luminoso independiente de la señal actual.
- [x] El ecualizador de 24 bandas interpola cada frecuencia con una respuesta diferenciada, caída natural, intensidad variable y retención corta del pico por banda.
- [x] Los eventos del proceso principal solo actualizan objetivos numéricos; ningún buffer de audio cruza hacia el renderer.
- [x] La animación respeta `prefers-reduced-motion` y reduce el uso de `will-change` cuando el usuario solicita menos movimiento.


### Fase de monitorización profesional — IMPLEMENTADA

- [x] El proceso principal calcula RMS estéreo, pico máximo, pico izquierda/derecha y detección de clip sobre cada bloque resumido de monitorización.
- [x] El evento `stream:vu-level` transporta únicamente métricas numéricas: `peak`, `db`, `rmsDb`, `leftDb`, `rightDb` y `clip`; nunca transporta el buffer PCM.
- [x] La interfaz muestra RMS, pico retenido, lectura estéreo L/R y estado de clip junto al vúmetro animado.
- [x] La semántica de señal distingue entre señal estable, señal baja, saturación y ausencia de señal.
- [x] Validación de sintaxis completada para `ffmpeg-stream.js`, `ipc-events.js` y `renderer.js`; Electron inició correctamente en modo desarrollo.


## Fase Podcast Studio — PRIMERA VERSIÓN FUNCIONAL IMPLEMENTADA

- [x] Nueva vista `Podcast Studio` en la navegación principal con identidad visual azul y estructura editorial.
- [x] Creación, selección, edición y eliminación de episodios persistidos en `app.getPath('userData')/podcast-studio/episodes.json`.
- [x] Metadatos de episodio: título, descripción, estado de borrador/exportado y ruta de exportación.
- [x] Línea de tiempo básica con clips de la Biblioteca, duración calculada, eliminación y reordenación por arrastre o controles arriba/abajo.
- [x] Biblioteca de recursos dentro del editor para añadir pistas a la línea de tiempo.
- [x] Exportación MP3 con FFmpeg, concatenación en orden, recorte básico por segmento y metadatos de título/comentario.
- [x] Progreso de exportación visible en la interfaz y actualización del episodio al terminar.
- [x] La exportación se ejecuta como proceso FFmpeg independiente y no altera el flujo de transmisión en vivo.
- [x] Prueba real con dos archivos de audio: exportación MP3 válida de 6 segundos confirmada mediante FFprobe.

### Pendiente para la siguiente iteración de Podcast Studio

La base funcional queda lista para ampliar con grabación directa dentro del editor, edición de forma de onda, recortes visuales con handles, pistas separadas para voz y música, normalización, portada, campos RSS y publicación en plataformas.


## Fase Podcast Studio — GRABACIÓN DIRECTA DE VOZ IMPLEMENTADA

- [x] Nuevo panel de captura directa dentro del editor de Podcast Studio.
- [x] La captura utiliza `naudiodon` en el proceso principal y no envía audio PCM por IPC.
- [x] FFmpeg codifica la toma localmente a MP3 de 192 kbps dentro de `app.getPath('userData')/podcast-studio/recordings`.
- [x] El editor muestra estado LISTO, GRABANDO, GUARDANDO y ERROR, además de temporizador y nivel de entrada en tiempo real.
- [x] La toma terminada se añade automáticamente como segmento `recording` al final del episodio activo.
- [x] El exportador de episodios acepta segmentos de biblioteca y tomas de voz absolutas guardadas por la aplicación.
- [x] La grabación se cierra al salir de la aplicación para evitar procesos FFmpeg huérfanos.
- [x] Los módulos modificados pasaron `node --check` y Electron inició correctamente con la nueva integración.

La prueba completa de hardware requiere seleccionar un micrófono válido en Configuración y pulsar “Grabar voz” desde Podcast Studio. Si `naudiodon` no está compilado en el equipo, la interfaz mostrará un error claro sin impedir el arranque del resto de la aplicación.


## Fase Podcast Studio — FORMA DE ONDA Y RECORTE NO DESTRUCTIVO IMPLEMENTADOS

- [x] Cada clip de Biblioteca o grabación de voz puede solicitar su forma de onda PNG generada con FFmpeg.
- [x] La forma de onda se muestra dentro de cada bloque de la línea de tiempo con una política CSP que solo permite `data:` para imágenes generadas localmente.
- [x] Cada segmento dispone de controles IN y OUT con precisión de décimas de segundo.
- [x] El recorte actualiza la duración del clip y la duración total del episodio sin modificar el archivo fuente.
- [x] Los valores `trimStart` y `trimEnd` se guardan en el episodio y el exportador los aplica mediante `atrim` al generar el MP3.
- [x] Se validó con un audio real la generación de una forma de onda PNG de 960 × 160 píxeles.
- [x] Los módulos modificados pasaron `node --check` y Electron inició correctamente con la nueva vista.

El siguiente paso recomendado es añadir preview por segmento y edición de volumen/fade in/fade out por clip para acercar el editor a una estación de producción de podcast completa.


## Fase Podcast Studio — PREVIEW, VOLUMEN Y FADES IMPLEMENTADOS

- [x] Cada segmento de la línea de tiempo tiene preview individual, respetando sus límites IN/OUT.
- [x] La preescucha aplica el volumen del segmento y la curva de fade in/fade out en tiempo real.
- [x] Cada clip dispone de volumen independiente entre 0 y 200 por ciento.
- [x] Se añadieron controles de fade in y fade out de 0 a 30 segundos por segmento.
- [x] El modelo persistente conserva `volume`, `fadeIn` y `fadeOut` junto con `trimStart` y `trimEnd`.
- [x] La exportación FFmpeg aplica `volume` y `afade` antes de concatenar los clips.
- [x] Se validó con audio real una exportación de 3,5 segundos con volumen al 75 por ciento, fade in de 0,4 segundos y fade out de 0,7 segundos.
- [x] Electron inició correctamente con la nueva integración y los módulos modificados pasaron `node --check`.

La siguiente mejora recomendada es incorporar automatización de volumen por envolvente y una mezcla multipista para voz, música e identidades sonoras.


## Fase Podcast Studio — MEZCLA MULTIPISTA Y ENVOLVENTE IMPLEMENTADAS

- [x] Cada segmento puede pertenecer a una pista de `voice`, `music` o `identity`.
- [x] Se añadió posición temporal editable para permitir solapamiento entre segmentos y crear una mezcla real.
- [x] El episodio calcula su duración como el final más lejano de todos los segmentos, incluyendo silencios y solapamientos.
- [x] Cada clip conserva hasta seis puntos de automatización de volumen con tiempo relativo y ganancia entre 0 y 200 por ciento.
- [x] La interfaz permite cambiar la pista, posición, ganancia de cada punto, añadir nuevos puntos y eliminar puntos adicionales.
- [x] La preescucha interpola la envolvente en tiempo real y la combina con fade in, fade out y volumen base.
- [x] La exportación crea buses separados de voz, música e identidad, mezcla los segmentos de cada bus y finalmente mezcla los buses con `amix`.
- [x] La exportación aplica los puntos de automatización mediante `volume=...:eval=frame` y mantiene los archivos originales intactos.
- [x] Se validó con dos audios reales una mezcla solapada de cuatro segundos con envolvente automatizada y FFprobe confirmó la duración.
- [x] Los módulos modificados pasaron `node --check` y Electron inició correctamente.

La siguiente mejora recomendada es añadir control de ganancia por bus, ducking automático de música bajo la voz y medición RMS/LUFS independiente para cada pista.


## Fase Podcast Studio — DUCKING Y LOUDNESS POR PISTA IMPLEMENTADOS

- [x] Se añadió configuración persistente de ducking con activación, reducción, umbral, ataque y recuperación.
- [x] La exportación utiliza `sidechaincompress` para reducir automáticamente el bus de música cuando el bus de voz supera el umbral.
- [x] Se conservaron buses separados de voz, música e identidad, con ganancia independiente por bus.
- [x] Se incorporó un panel visual de monitorización con RMS, LUFS integrado, pico y cantidad de clips por pista.
- [x] La medición usa FFmpeg `astats` para RMS/pico y `ebur128` para LUFS, calculando valores ponderados por duración dentro de cada bus.
- [x] Se validó el ducking con dos audios reales y se obtuvo una exportación MP3 válida de cuatro segundos.
- [x] Se validó la lectura real de métricas con RMS de -18,1 dB, pico de -4,6 dB y LUFS de -15,9 LUFS en una pista de prueba.
- [x] Los módulos modificados pasaron `node --check` y Electron inició correctamente.

La siguiente mejora recomendada es una fase de masterización final con target LUFS del episodio, limitador true peak y exportación de un informe de loudness junto con el MP3.


## Optimización de exportación FFmpeg para episodios largos

La exportación de Podcast Studio ahora utiliza un flujo de procesamiento más controlado para episodios extensos. FFmpeg se ejecuta sin entrada interactiva, con hilos de filtro limitados dinámicamente según la CPU disponible, cola de multiplexado ampliada y un periodo de progreso de 500 milisegundos. El renderer recibe actualizaciones limitadas a intervalos útiles, evitando repintados y eventos IPC innecesarios.

La exportación se puede cancelar desde el botón **Cancelar exportación**. Al cancelar, el proceso FFmpeg se termina, se elimina el archivo parcial y se informa claramente al usuario. También se evita iniciar dos exportaciones simultáneas y el cierre de Electron limpia cualquier exportación activa.

La mezcla multipista, el ducking, los fades, los recortes y la automatización de volumen siguen ejecutándose dentro del mismo grafo FFmpeg, sin cargar el episodio completo en memoria desde JavaScript.

La validación con una fuente de audio real de 60 segundos produjo un MP3 de 60 segundos en aproximadamente 3,92 segundos con mezcla, automatización y ducking activos. La corrección de argumentos confirmó que `max_muxing_queue_size` se aplica en la posición compatible con FFmpeg. Los módulos modificados pasaron `node --check` y Electron inició correctamente.


## Adaptadores de proveedores de radio — implementado

La configuración de transmisión ahora utiliza `src/main/radio-providers.js` como registro único de proveedores. El renderer obtiene el catálogo mediante IPC y conserva el proveedor seleccionado en `settings.json`, manteniendo `zeno-icecast` como valor por defecto para que las configuraciones anteriores sigan funcionando.

| Proveedor | Protocolo de fuente | Campos principales | Perfil FFmpeg |
|---|---|---|---|
| Zeno.fm · Icecast | Icecast | Host, puerto, mountpoint, usuario y contraseña | URL `icecast://` con `-legacy_icecast 1` |
| Centova Cast · Icecast | Icecast | Host, puerto, mountpoint, usuario y contraseña | URL `icecast://` con `-legacy_icecast 1` |
| Centova Cast · SHOUTcast | SHOUTcast ICY sobre TCP | Host, puerto, contraseña y Stream ID opcional | FFmpeg codifica a `pipe:1`; `shoutcast-source.js` realiza el handshake ICY y envía MP3 |

En Centova Cast, los datos deben copiarse desde **Live Source Connections**. El campo de mountpoint se oculta cuando se selecciona SHOUTcast y aparece el campo específico de Stream ID; en Icecast, el mountpoint se considera obligatorio. La interfaz también ofrece mostrar u ocultar la contraseña, copiar host, mountpoint, Stream ID y contraseña, actualizar placeholders por proveedor y mostrar validación visual de los campos.

El motor `ffmpeg-stream.js` ya no construye una URL Icecast fija. En su lugar, llama a `buildEncoderProfile(config)` y utiliza el perfil del proveedor tanto al conectar como al reconectar automáticamente. Para SHOUTcast, FFmpeg codifica el MP3 a `stdout` y `shoutcast-source.js` abre un socket TCP, envía la autenticación `password[:streamId]`, espera `OK2/OK`, transmite las cabeceras `icy-*` y respeta el backpressure del socket. Si un servidor concreto requiere una variante de Stream ID, ruta de fuente o credencial específica, debe prevalecer la plantilla indicada por su panel de **Live Source Connections**.

- [x] Registro de Zeno.fm/Icecast y Centova Cast Icecast/SHOUTcast.
- [x] Integración de perfiles de proveedor en la conexión inicial y las reconexiones.
- [x] Persistencia retrocompatible del campo `provider` y del `streamId` opcional.
- [x] Selector dinámico con placeholders, campos requeridos y validación visual.
- [x] Acciones de interfaz para mostrar/ocultar y copiar credenciales.
- [x] Pruebas automatizadas de URL, argumentos FFmpeg y validaciones en `test-radio-providers.js`.
- [x] Prueba local del handshake ICY, Stream ID, cabeceras y escritura de MP3 en `test-shoutcast-source.js`.
- [x] Prueba de integración de FFmpeg: el perfil SHOUTcast produce MP3 válido por `pipe:1` en `test-ffmpeg-shoutcast-profile.js`.
