@echo off
REM ============================================================
REM  Respaldo de la base de datos.
REM
REM  Corre solo todos los dias a las 5 AM (lo programa INSTALAR.bat),
REM  pero tambien se puede correr a mano con doble clic antes de
REM  algo delicado: cambiar precios, borrar platillos, actualizar.
REM
REM  Guarda los ultimos 30 dias y borra los mas viejos.
REM ============================================================

cd /d "%~dp0"

set ORIGEN=server\datos\taqueria.db
set DESTINO=server\datos\respaldos

if not exist "%ORIGEN%" (
    echo   [X] No se encontro la base de datos en %ORIGEN%
    if "%1"=="" pause
    exit /b 1
)

if not exist "%DESTINO%" mkdir "%DESTINO%"

REM Fecha como AAAAMMDD-HHMM, sin depender del formato regional de Windows
REM (que cambia entre maquinas y dejaba nombres rotos con diagonales).
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set FECHA=%%i

set ARCHIVO=%DESTINO%\taqueria-%FECHA%.db

REM Se usa la copia de seguridad DE SQLITE y no un copy: si alguien esta
REM cobrando justo en este momento, un copy normal puede llevarse la base a
REM medio escribir y el respaldo queda corrupto sin que nadie se entere hasta
REM que lo necesita. El backup de SQLite espera a que la transaccion cierre.
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec(`VACUUM INTO '${process.argv[2].replace(/\\/g,'/').replace(/'/g,\"''\")}'`);db.close();" "%ORIGEN%" "%ARCHIVO%" 2>nul

if errorlevel 1 (
    echo   [X] Fallo el respaldo.
    if "%1"=="" pause
    exit /b 1
)

echo   Respaldo hecho: %ARCHIVO%

REM Limpieza: se conservan 30 dias. Sin esto la carpeta crece para siempre.
powershell -NoProfile -Command "Get-ChildItem '%DESTINO%\taqueria-*.db' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force" 2>nul

REM Si se corrio a mano (sin parametro), se deja la ventana abierta.
if "%1"=="" (
    echo.
    echo   Respaldos guardados:
    dir /b /o-d "%DESTINO%\taqueria-*.db" 2>nul
    echo.
    pause
)
