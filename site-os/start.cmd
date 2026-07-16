@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo JARVIS Site OS wymaga Node.js 18 lub nowszego.
  echo Pobierz Node.js ze strony https://nodejs.org/
  echo.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3210"
echo.
echo Uruchamiam JARVIS Site OS...
echo Zamkniecie tego okna zatrzyma lokalny edytor i tunel.
echo.
node server.mjs
if errorlevel 1 pause
