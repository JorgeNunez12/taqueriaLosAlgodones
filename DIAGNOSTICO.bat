@echo off
REM ============================================================
REM  Revision rapida cuando algo no funciona.
REM
REM  Doble clic y leer. Dice que esta bien y que no, en espanol,
REM  para poder decirle a alguien por telefono que pasa.
REM ============================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"
chcp 65001 >nul 2>&1

echo.
echo   ============================================
echo     TACOS LOS ALGODONES - Diagnostico
echo   ============================================
echo.

REM --- Node -----------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo   [X] Node.js NO esta instalado.
    echo       Sin esto nada funciona. Bajalo de https://nodejs.org
    goto :fin
)
for /f %%v in ('node --version') do echo   [OK] Node %%v

REM --- El servidor responde? ------------------------------------------------
REM Se pregunta por HTTP y no por "hay un proceso node": puede haber un node
REM corriendo que no sea este, o estar trabado sin contestar.
node -e "fetch('http://localhost:3000/api/salud').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" >nul 2>&1
if errorlevel 1 (
    echo   [X] El servidor NO esta respondiendo.
    echo.
    echo        Para levantarlo ahora:
    echo           schtasks /Run /TN "TaqueriaAlgodones"
    echo        o doble clic en INICIAR.bat
    set PROBLEMA=1
) else (
    echo   [OK] El servidor esta respondiendo
)

REM --- Tarea de arranque ----------------------------------------------------
schtasks /Query /TN "TaqueriaAlgodones" >nul 2>&1
if errorlevel 1 (
    echo   [X] NO esta configurado el arranque automatico.
    echo        Corre INSTALAR.bat como administrador.
    set PROBLEMA=1
) else (
    echo   [OK] Arranque automatico configurado
)

REM --- Respaldos ------------------------------------------------------------
schtasks /Query /TN "TaqueriaAlgodonesRespaldo" >nul 2>&1
if errorlevel 1 (
    echo   [AVISO] No hay respaldo automatico programado.
) else (
    echo   [OK] Respaldo diario programado
)

if exist "server\datos\respaldos\*.db" (
    for /f %%f in ('dir /b /o-d "server\datos\respaldos\taqueria-*.db" 2^>nul') do (
        echo        Ultimo respaldo: %%f
        goto :trasrespaldo
    )
)
:trasrespaldo

REM --- Base de datos --------------------------------------------------------
if not exist "server\datos\taqueria.db" (
    echo   [X] NO se encuentra la base de datos.
    set PROBLEMA=1
) else (
    node --disable-warning=ExperimentalWarning server\revisar-base.js "server/datos/taqueria.db"
    if errorlevel 1 set PROBLEMA=1
)

REM --- App compilada --------------------------------------------------------
if not exist "client\dist\index.html" (
    echo   [X] La app para las tablets NO esta compilada.
    echo        Corre INSTALAR.bat.
    set PROBLEMA=1
) else (
    echo   [OK] App compilada
)

REM --- Firewall -------------------------------------------------------------
netsh advfirewall firewall show rule name="Taqueria Algodones" >nul 2>&1
if errorlevel 1 (
    echo   [AVISO] El puerto puede estar cerrado en el Firewall.
    echo        Si las tablets no conectan, corre INSTALAR.bat como admin.
) else (
    echo   [OK] Puerto abierto en el Firewall
)

REM --- Direccion para las tablets -------------------------------------------
echo.
echo   Direccion para las tablets:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    set IP=%%a
    set IP=!IP: =!
    echo        http://!IP!:3000
)

:fin
echo.
if defined PROBLEMA (
    echo   ============================================
    echo     HAY PROBLEMAS - revisa las lineas con [X]
    echo   ============================================
) else (
    echo   ============================================
    echo     TODO EN ORDEN
    echo   ============================================
)
echo.
pause
