@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Instalador - Stock Comic Stores v3.0

echo.
echo ==========================================================
echo   Stock Comic Stores v3.0 - instalador
echo ==========================================================
echo.
echo   Publica esta app en un repositorio de GitHub NUEVO y,
echo   opcionalmente, despliega un Worker de Cloudflare NUEVO.
echo   No toca la app de PVP que ya tienes funcionando.
echo.

REM ---------------------------------------------------------------
REM  1. Comprobaciones previas
REM ---------------------------------------------------------------
echo [1/6] Comprobando herramientas...

where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [ERROR] No se encuentra Git.
  echo   Instalalo desde https://git-scm.com/download/win y vuelve a ejecutar.
  goto :fin
)

where gh >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [ERROR] No se encuentra GitHub CLI.
  echo   Instalalo desde https://cli.github.com y vuelve a ejecutar.
  echo   O ejecuta:  winget install --id GitHub.cli
  goto :fin
)

gh auth status >nul 2>&1
if errorlevel 1 (
  echo   No has iniciado sesion en GitHub. Se abrira el navegador...
  gh auth login -w
  if errorlevel 1 goto :fin
)

git config user.email >nul 2>&1
if errorlevel 1 (
  echo   Configurando identidad de Git para este repositorio...
  git config --global user.name "Carlos Moreno"
  git config --global user.email "carlos.moreno@gmail.com"
)

echo   OK.
echo.

REM ---------------------------------------------------------------
REM  2. Datos de la instalacion
REM ---------------------------------------------------------------
echo [2/6] Datos de la instalacion (Enter = valor entre corchetes)
echo.

set "USUARIO=carl0sm0ren0"
set /p "USUARIO=  Usuario de GitHub [%USUARIO%]: "

set "REPO=Buscador_Stock"
set /p "REPO=  Nombre del repositorio nuevo [%REPO%]: "

set "CUENTA=carlos-moreno"
set /p "CUENTA=  Subdominio workers.dev de tu cuenta [%CUENTA%]: "

set "WORKER=buscadorstock"
set /p "WORKER=  Nombre del Worker nuevo [%WORKER%]: "

echo.
echo   Web    : https://%USUARIO%.github.io/%REPO%/
echo   Worker : https://%WORKER%.%CUENTA%.workers.dev
echo.
set "SEGUIR=S"
set /p "SEGUIR=  Es correcto? [S/n]: "
if /i "%SEGUIR%"=="n" goto :fin

REM ---------------------------------------------------------------
REM  3. Ajustar la URL del Worker en el codigo
REM ---------------------------------------------------------------
echo.
echo [3/6] Ajustando la configuracion...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_configurar.ps1" -Worker "%WORKER%" -Cuenta "%CUENTA%"
if errorlevel 1 goto :fin

REM ---------------------------------------------------------------
REM  4. Repositorio de GitHub
REM ---------------------------------------------------------------
echo.
echo [4/6] Publicando en GitHub...

if exist ".git" (
  echo   Ya existe un repositorio local: se sube solo lo que haya cambiado.
  git add -A
  git commit -m "Actualizacion de Stock Comic Stores" 2>nul
  git push
) else (
  git init -b main
  git add -A
  git commit -m "Stock Comic Stores v3.0"
  gh repo create "%USUARIO%/%REPO%" --public --source=. --remote=origin --push
  if errorlevel 1 (
    echo.
    echo   [ERROR] No se pudo crear el repositorio.
    echo   Comprueba que el nombre "%REPO%" no exista ya en tu cuenta.
    goto :fin
  )
)

REM ---------------------------------------------------------------
REM  5. Activar GitHub Pages
REM ---------------------------------------------------------------
echo.
echo [5/6] Activando GitHub Pages...
gh api --method POST -H "Accept: application/vnd.github+json" "/repos/%USUARIO%/%REPO%/pages" -f "source[branch]=main" -f "source[path]=/" >nul 2>&1
if errorlevel 1 (
  echo   Aviso: no se pudo activar por API (quiza ya estaba activo).
  echo   Si la web no carga, activalo a mano en:
  echo   https://github.com/%USUARIO%/%REPO%/settings/pages
  echo   Source: Deploy from a branch  ^|  Branch: main  ^|  Carpeta: / (root)
) else (
  echo   OK. Tarda 1-2 minutos en estar disponible.
)

REM ---------------------------------------------------------------
REM  6. Worker de Cloudflare (opcional)
REM ---------------------------------------------------------------
echo.
echo [6/6] Worker de Cloudflare
echo.
echo   Puedes desplegarlo ahora con Wrangler (necesita Node.js), o mas
echo   tarde a mano desde el panel de Cloudflare copiando worker.js.
echo.
set "DESPLEGAR=S"
set /p "DESPLEGAR=  Desplegar ahora con Wrangler? [S/n]: "
if /i "%DESPLEGAR%"=="n" goto :resumen

where npx >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [AVISO] No se encuentra Node.js, asi que no puedo usar Wrangler.
  echo   Instalalo desde https://nodejs.org o crea el Worker a mano.
  goto :resumen
)

echo   Si es la primera vez, se abrira el navegador para autorizar Cloudflare.
call npx --yes wrangler@latest deploy
if errorlevel 1 (
  echo.
  echo   [AVISO] El despliegue no termino bien. Puedes reintentarlo con:
  echo     npx wrangler deploy
)

:resumen
echo.
echo ==========================================================
echo   Listo
echo ==========================================================
echo.
echo   Web     : https://%USUARIO%.github.io/%REPO%/
echo   Worker  : https://%WORKER%.%CUENTA%.workers.dev
echo   Prueba  : https://%WORKER%.%CUENTA%.workers.dev/?ean=8437012332577^&nocache=1
echo.
echo   En el movil: abre la web en Chrome y elige "Anadir a pantalla de
echo   inicio". El icono nuevo (turquesa con STOCK) la distingue de la
echo   app de PVP que ya tenias.
echo.

:fin
echo.
pause
endlocal
