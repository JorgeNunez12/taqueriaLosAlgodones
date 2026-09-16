@echo off
REM Levanta el servidor a mano, cuando se cayo o se paro a proposito.
REM Normalmente no hace falta: arranca solo al prender la computadora.
cd /d "%~dp0"
echo.
echo   Arrancando el servidor de la taqueria...
schtasks /Run /TN "TaqueriaAlgodones" >nul 2>&1
if errorlevel 1 (
    echo   [AVISO] No existe la tarea; arrancando en esta ventana.
    echo       NO CIERRES ESTA VENTANA mientras se use el sistema.
    echo.
    cd server
    node --env-file-if-exists=.env --disable-warning=ExperimentalWarning src\index.js
) else (
    timeout /t 4 /nobreak >nul
    echo   Listo. Revisa con DIAGNOSTICO.bat si hace falta.
    timeout /t 3 /nobreak >nul
)
