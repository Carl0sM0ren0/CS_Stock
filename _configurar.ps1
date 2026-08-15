param(
  [Parameter(Mandatory=$true)][string]$Worker,
  [Parameter(Mandatory=$true)][string]$Cuenta
)

$ErrorActionPreference = 'Stop'
$sinBom = New-Object System.Text.UTF8Encoding($false)
$url = "https://$Worker.$Cuenta.workers.dev"

# app.js -> apunta al Worker elegido
$ruta = Join-Path $PSScriptRoot 'app.js'
$texto = [System.IO.File]::ReadAllText($ruta, [System.Text.Encoding]::UTF8)
$nuevo = [regex]::Replace($texto, "const API_URL = '[^']*';", "const API_URL = '$url';")
[System.IO.File]::WriteAllText($ruta, $nuevo, $sinBom)

# wrangler.toml -> nombre del Worker
$ruta = Join-Path $PSScriptRoot 'wrangler.toml'
$texto = [System.IO.File]::ReadAllText($ruta, [System.Text.Encoding]::UTF8)
$nuevo = [regex]::Replace($texto, '(?m)^name\s*=.*$', "name = `"$Worker`"")
[System.IO.File]::WriteAllText($ruta, $nuevo, $sinBom)

Write-Host "  app.js apunta a $url"
Write-Host "  wrangler.toml usa el Worker '$Worker'"
