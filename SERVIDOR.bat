@echo off
REM Lanzador del servidor. Lo llama la tarea programada al prender la PC.
REM
REM Existe como archivo aparte por una razon practica: la carpeta puede tener
REM espacios en el nombre ("taqueria del pastor"), y meter esa ruta dentro del
REM comando de schtasks lo rompe de formas dificiles de ver. Apuntando la tarea
REM a este .bat, el unico que tiene que lidiar con la ruta es %~dp0, que siempre
REM trae la carpeta correcta sin importar como se llame ni desde donde se llame.
cd /d "%~dp0server"
node --env-file-if-exists=.env --disable-warning=ExperimentalWarning src\index.js >> "%~dp0server\datos\servidor.log" 2>&1
