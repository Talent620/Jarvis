@echo off
REM JARVIS — Serwer obrazow (Stable Diffusion): DWUKLIKALNY launcher.
REM Poloz ten plik w folderze swojego Forge/A1111 (tam, gdzie webui-user.bat) i kliknij dwa razy.
setlocal
title JARVIS - Serwer obrazow (SD)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jarvis-sd-server.ps1"
echo.
pause
