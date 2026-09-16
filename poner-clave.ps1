# Pone la clave del encargado en server\.env
#
# Esta en PowerShell y no en un .bat porque los .bat con set /p se rompen de
# formas invisibles: parentesis en el texto de la pregunta, comparaciones que
# se expanden antes de tiempo, finales de linea de Unix. PowerShell lee lo que
# el usuario teclea sin nada de eso.
#
# No se corre solo: lo lanza PONER-CLAVE.bat, que es el que se toca.

$ErrorActionPreference = 'Stop'
$carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$destino = Join-Path $carpeta 'server\.env'

Write-Host ''
Write-Host '  ============================================'
Write-Host '    Clave del Encargado'
Write-Host '  ============================================'
Write-Host ''
Write-Host '  Es la clave para entrar a la pantalla del Encargado,'
Write-Host '  donde esta el corte del dia y el menu.'
Write-Host ''

if (Test-Path $destino) {
    Write-Host '  Ya hay una clave puesta en esta computadora.'
    $r = Read-Host '  Quieres cambiarla? S o N'
    if ($r -notmatch '^[sS]') {
        Write-Host ''
        Write-Host '  No se cambio nada.'
        Write-Host ''
        Read-Host '  Presiona Enter para cerrar' | Out-Null
        exit 0
    }
    Write-Host ''
}

$usuario = Read-Host '  Usuario (deja vacio para usar: algodones)'
if ([string]::IsNullOrWhiteSpace($usuario)) { $usuario = 'algodones' }

do {
    $clave = Read-Host '  Contrasena'
    if ([string]::IsNullOrWhiteSpace($clave)) {
        Write-Host '  [X] La contrasena no puede quedar vacia.'
    }
} while ([string]::IsNullOrWhiteSpace($clave))

# La carpeta server tiene que existir: si alguien corre esto antes de
# descomprimir bien, mejor decirlo que dejar un .env en la nada.
$carpetaServer = Join-Path $carpeta 'server'
if (-not (Test-Path $carpetaServer)) {
    Write-Host ''
    Write-Host '  [X] No se encontro la carpeta "server".'
    Write-Host '      Corre esto desde la carpeta del sistema.'
    Write-Host ''
    Read-Host '  Presiona Enter para cerrar' | Out-Null
    exit 1
}

# ASCII para que node lo lea sin tropezar con el BOM que PowerShell pone por
# defecto en UTF8.
"TAQUERIA_USUARIO=$usuario`nTAQUERIA_CLAVE=$clave`n" |
    Out-File -FilePath $destino -Encoding ascii -NoNewline

Write-Host ''
Write-Host '  ============================================'
Write-Host '    Clave guardada'
Write-Host '  ============================================'
Write-Host ''
Write-Host "    Usuario:     $usuario"
Write-Host "    Contrasena:  $clave"
Write-Host ''
Write-Host '  Apuntala donde no se pierda.'
Write-Host ''

# Si ya estaba corriendo, trae la clave vieja en memoria y hay que reiniciarlo.
#
# La salida de schtasks se traga entera: cuando la tarea no existe todavia
# (instalacion nueva) escribe un error rojo en pantalla que asusta sin motivo.
$tareaExiste = $false
try {
    $null = schtasks /Query /TN 'TaqueriaAlgodones' 2>&1
    $tareaExiste = ($LASTEXITCODE -eq 0)
} catch {
    $tareaExiste = $false
}

if ($tareaExiste) {
    Write-Host '  Reiniciando el servidor para que tome la clave nueva...'
    schtasks /End /TN 'TaqueriaAlgodones' 2>$null | Out-Null
    Start-Sleep -Seconds 2
    schtasks /Run /TN 'TaqueriaAlgodones' 2>$null | Out-Null
    Start-Sleep -Seconds 3
    Write-Host '  Listo.'
    Write-Host ''
}

Read-Host '  Presiona Enter para cerrar' | Out-Null
