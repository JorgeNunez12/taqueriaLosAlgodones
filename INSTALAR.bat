@echo off
REM ============================================================
REM  Tacos Los Algodones - Instalador para la computadora nueva
REM
REM  Que hace:
REM    1. Revisa que Node este instalado y sea la version que se necesita.
REM    2. Instala las dependencias del servidor y compila la app.
REM    3. Deja el servidor arrancando SOLO cuando prende la computadora.
REM    4. Programa un respaldo diario de la base de datos.
REM    5. Abre el puerto en el Firewall para que entren las tablets.
REM
REM  Se corre UNA VEZ, con clic derecho > "Ejecutar como administrador".
REM ============================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   ============================================
echo     TACOS LOS ALGODONES - Instalacion
echo   ============================================
echo.

REM --- Permisos de administrador -------------------------------------------
REM Sin esto no se puede crear la tarea de arranque ni tocar el Firewall.
net session >nul 2>&1
if errorlevel 1 (
    echo   [X] Hay que correr esto COMO ADMINISTRADOR.
    echo.
    echo       Cierra esta ventana, busca INSTALAR.bat, dale
    echo       CLIC DERECHO y elige "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

REM --- 1. Node --------------------------------------------------------------
echo   [1/5] Revisando Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [X] Node.js no esta instalado en esta computadora.
    echo.
    echo       Bajalo de:  https://nodejs.org
    echo       Elige la version LTS ^(la de la izquierda^) e instalala
    echo       con Siguiente-Siguiente. Luego vuelve a correr esto.
    echo.
    pause
    exit /b 1
)

REM El sistema usa el SQLite que Node trae incluido, y eso existe desde la
REM 22.5. Con una version mas vieja el servidor truena al primer pedido.
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set MAYOR=%%v
if !MAYOR! LSS 22 (
    echo.
    echo   [X] Node esta muy viejo ^(se necesita 22.5 o mas nuevo^).
    node --version
    echo.
    echo       Instala la version LTS desde https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f %%v in ('node --version') do echo        Node %%v - OK

REM --- 2. Dependencias y compilado -----------------------------------------
echo.
echo   [2/5] Instalando el servidor... ^(tarda un poco^)
cd server
call npm install --omit=dev --no-audit --no-fund >nul 2>&1
if errorlevel 1 (
    echo   [X] Fallo la instalacion del servidor.
    echo       Revisa que haya internet y vuelve a intentar.
    cd ..
    pause
    exit /b 1
)
cd ..

REM La app compilada (client\dist) es lo que el servidor les sirve a las
REM tablets. Si no viene en la copia, se compila aqui.
if exist "client\dist\index.html" (
    echo        La app ya viene compilada - OK
) else (
    echo        Compilando la app para las tablets...
    cd client
    call npm install --no-audit --no-fund >nul 2>&1
    call npm run build >nul 2>&1
    if errorlevel 1 (
        echo   [X] Fallo al compilar la app.
        cd ..
        pause
        exit /b 1
    )
    cd ..
    echo        Compilada - OK
)

REM --- 3. Arranque automatico ----------------------------------------------
echo.
echo   [3/5] Configurando el arranque automatico...

REM Se usa el Programador de tareas y no un "servicio" de Windows porque una
REM tarea se ve, se para y se vuelve a lanzar desde una ventana que cualquiera
REM entiende, sin instalar nada extra. Corre como SYSTEM para que arranque
REM aunque nadie inicie sesion en la computadora.
schtasks /Query /TN "TaqueriaAlgodones" >nul 2>&1
if not errorlevel 1 schtasks /Delete /TN "TaqueriaAlgodones" /F >nul 2>&1

REM La tarea apunta a SERVIDOR.bat y no al comando completo: la carpeta puede
REM tener espacios en el nombre, y meter esa ruta dentro del comando de schtasks
REM lo rompe con un "argumento no valido" dificil de diagnosticar.
schtasks /Create /TN "TaqueriaAlgodones" ^
    /TR "\"%CD%\SERVIDOR.bat\"" ^
    /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul 2>&1
if errorlevel 1 (
    echo   [X] No se pudo crear la tarea de arranque.
    pause
    exit /b 1
)
echo        Listo - el servidor va a arrancar solo al prender la PC

REM --- 4. Respaldo diario ---------------------------------------------------
echo.
echo   [4/5] Programando el respaldo diario...

if not exist "server\datos\respaldos" mkdir "server\datos\respaldos"

schtasks /Query /TN "TaqueriaAlgodonesRespaldo" >nul 2>&1
if not errorlevel 1 schtasks /Delete /TN "TaqueriaAlgodonesRespaldo" /F >nul 2>&1

REM A las 5 de la manana: el local esta cerrado y nadie esta cobrando.
schtasks /Create /TN "TaqueriaAlgodonesRespaldo" ^
    /TR "\"%CD%\RESPALDAR.bat\" auto" ^
    /SC DAILY /ST 05:00 /RU SYSTEM /RL HIGHEST /F >nul 2>&1
if errorlevel 1 (
    echo   [AVISO] No se pudo programar el respaldo automatico.
    echo       El sistema funciona igual; corre RESPALDAR.bat a mano.
) else (
    echo        Listo - respaldo diario a las 5:00 AM
)

REM --- 5. Firewall ----------------------------------------------------------
echo.
echo   [5/5] Abriendo el puerto para las tablets...
netsh advfirewall firewall delete rule name="Taqueria Algodones" >nul 2>&1
netsh advfirewall firewall add rule name="Taqueria Algodones" ^
    dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
if errorlevel 1 (
    echo   [AVISO] No se pudo abrir el puerto automaticamente.
    echo       Si las tablets no conectan, hay que abrir el
    echo       puerto 3000 en el Firewall de Windows a mano.
) else (
    echo        Puerto 3000 abierto - OK
)

REM --- Arrancar ya, sin esperar a reiniciar --------------------------------
echo.
echo   Arrancando el servidor...
schtasks /Run /TN "TaqueriaAlgodones" >nul 2>&1
timeout /t 4 /nobreak >nul

echo.
echo   ============================================
echo     LISTO
echo   ============================================
echo.
echo   En las tablets, abre el navegador y entra a:
echo.

REM La IP de la LAN es lo que hay que teclear en cada tablet.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    set IP=%%a
    set IP=!IP: =!
    echo        http://!IP!:3000
)
echo.
echo   Clave del encargado: la que pusiste en server.env
echo.
echo   Si algo falla, corre DIAGNOSTICO.bat
echo.
pause
