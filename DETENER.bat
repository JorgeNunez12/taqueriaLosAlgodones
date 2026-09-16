@echo off
REM Para el servidor. Se usa antes de actualizar o mover la instalacion.
REM Ojo: mientras este parado, las tablets no pueden cobrar.
cd /d "%~dp0"
echo.
echo   Deteniendo el servidor...
schtasks /End /TN "TaqueriaAlgodones" >nul 2>&1
REM Por si quedo algun node suelto sirviendo el puerto 3000.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
echo   Servidor detenido.
timeout /t 3 /nobreak >nul
