@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Instalador - Stock Comic Stores v3.0

echo.
echo ==========================================================
echo   Stock Comic Stores v3.0 - instalador
echo ==========================================================
echo.
echo   Publica esta app en un repositorio de GitHub nuevo y,
echo   opcionalmente, despliega un Worker de Cloudflare nuevo.
echo   No toca la app de PVP que ya tienes funcionando.
echo.

REM ===============================================================
REM  1. Comprobaciones previas
REM ===============================================================
echo [1/6] Comprobando herramientas...

where git >nul 2>&1
if errorlevel 1 goto :falta_git

where gh >nul 2>&1
if errorlevel 1 goto :falta_gh

gh auth status >nul 2>&1
if errorlevel 1 call :login_github
if errorlevel 1 goto :fin

git config --global user.email >nul 2>&1
if errorlevel 1 call :identidad_git

echo   OK.
echo.

REM ===============================================================
REM  2. Datos de la instalacion
REM ===============================================================
echo [2/6] Datos de la instalacion. Pulsa Enter para el valor entre corchetes.
echo.

set "USUARIO=carl0sm0ren0"
set /p "USUARIO=  Usuario de GitHub [%USUARIO%]: "

set "REPO=CS_Stock"
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

REM ===============================================================
REM  3. Ajustar la URL del Worker en el codigo
REM ===============================================================
echo.
echo [3/6] Ajustando la configuracion...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_configurar.ps1" -Worker "%WORKER%" -Cuenta "%CUENTA%"
if errorlevel 1 goto :fin

REM ===============================================================
REM  4. Repositorio de GitHub
REM ===============================================================
echo.
echo [4/6] Publicando en GitHub...

git rev-parse --git-dir >nul 2>&1
if errorlevel 1 git init >nul

REM Evita los avisos de LF/CRLF al subir el codigo.
if not exist ".gitattributes" echo * text=auto eol=lf> .gitattributes

git add -A
git commit -m "Stock Comic Stores v3.0" >nul 2>&1

REM La rama debe llamarse main: es la que sirve GitHub Pages.
git branch -M main >nul 2>&1
if errorlevel 1 git branch -m master main >nul 2>&1

REM Si ya hay un remoto configurado, basta con subir.
git remote get-url origin >nul 2>&1
if not errorlevel 1 goto :subir

REM Si el repositorio ya existe en GitHub, se enlaza en vez de crearlo.
gh repo view "%USUARIO%/%REPO%" >nul 2>&1
if not errorlevel 1 goto :enlazar

echo   Creando el repositorio %USUARIO%/%REPO% ...
gh repo create "%USUARIO%/%REPO%" --public --source=. --remote=origin --push
if errorlevel 1 goto :error_repo
goto :repo_listo

:enlazar
echo   El repositorio ya existia: se enlaza y se sube.
git remote add origin "https://github.com/%USUARIO%/%REPO%.git"

:subir
git push -u origin main
if errorlevel 1 goto :error_push

:repo_listo
echo   Codigo subido.

REM ===============================================================
REM  5. Activar GitHub Pages
REM ===============================================================
echo.
echo [5/6] Activando GitHub Pages...
gh api --method POST -H "Accept: application/vnd.github+json" "/repos/%USUARIO%/%REPO%/pages" -f "source[branch]=main" -f "source[path]=/" >nul 2>&1
if errorlevel 1 goto :pages_manual
echo   Activado. Tarda 1-2 minutos en estar disponible.
goto :cloudflare

:pages_manual
gh api "/repos/%USUARIO%/%REPO%/pages" >nul 2>&1
if not errorlevel 1 goto :pages_ya
echo   Aviso: no se pudo activar por API. Hazlo a mano aqui:
echo     https://github.com/%USUARIO%/%REPO%/settings/pages
echo     Source: Deploy from a branch   Branch: main   Carpeta: raiz
goto :cloudflare

:pages_ya
echo   Ya estaba activado.

REM ===============================================================
REM  6. Worker de Cloudflare
REM ===============================================================
:cloudflare
echo.
echo [6/6] Worker de Cloudflare
echo.
echo   Puedes desplegarlo ahora con Wrangler, que necesita Node.js, o mas
echo   tarde a mano desde el panel de Cloudflare copiando worker.js.
echo.
set "DESPLEGAR=S"
set /p "DESPLEGAR=  Desplegar ahora con Wrangler? [S/n]: "
if /i "%DESPLEGAR%"=="n" goto :resumen

where npx >nul 2>&1
if errorlevel 1 goto :sin_node

echo   Si es la primera vez se abrira el navegador para autorizar Cloudflare.
call npx --yes wrangler@latest deploy
if errorlevel 1 echo   Aviso: el despliegue no termino bien. Reintenta con: npx wrangler deploy
goto :resumen

:sin_node
echo   Aviso: no se encuentra Node.js, asi que no puedo usar Wrangler.
echo   Instalalo desde https://nodejs.org o crea el Worker a mano.

REM ===============================================================
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
echo   En el movil: abre la web en Chrome y elige Anadir a pantalla de
echo   inicio. El icono turquesa con la banda STOCK la distingue de la
echo   app de PVP que ya tenias.
echo.
goto :fin

REM ===============================================================
REM  Subrutinas y errores
REM ===============================================================
:login_github
echo   No has iniciado sesion en GitHub. Se abrira el navegador...
gh auth login -w
exit /b %errorlevel%

:identidad_git
echo   Configurando la identidad de Git...
git config --global user.name "Carlos Moreno"
git config --global user.email "carlos.moreno@gmail.com"
exit /b 0

:falta_git
echo.
echo   ERROR: no se encuentra Git.
echo   Instalalo desde https://git-scm.com/download/win y vuelve a ejecutar.
goto :fin

:falta_gh
echo.
echo   ERROR: no se encuentra GitHub CLI.
echo   Instalalo con:  winget install --id GitHub.cli
echo   O descargalo de https://cli.github.com
goto :fin

:error_repo
echo.
echo   ERROR: no se pudo crear el repositorio %USUARIO%/%REPO%.
echo   Prueba con otro nombre, o crealo a mano en https://github.com/new
goto :fin

:error_push
echo.
echo   ERROR: no se pudo subir el codigo.
echo   Comprueba la sesion con:  gh auth status
goto :fin

:fin
echo.
pause
endlocal
