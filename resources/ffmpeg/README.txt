Coloca aqui el binario de ffmpeg.exe (build estatico para Windows x64) que se
empaquetara junto con la app (ver "extraResources" en package.json).

Fuente recomendada: https://www.gyan.dev/ffmpeg/builds/ (build "essentials",
version release, static).

Este archivo se sube a git como marcador de la carpeta; el binario real
(ffmpeg.exe) debe agregarse a .gitignore si el repositorio es publico, o
descargarse en un paso de build, para no inflar el historial de git con un
binario pesado.
