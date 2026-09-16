@echo off
REM Boton para poner la clave del encargado.
REM El trabajo lo hace poner-clave.ps1; este .bat solo lo lanza, porque un
REM archivo .ps1 no se ejecuta con doble clic en Windows.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0poner-clave.ps1"
