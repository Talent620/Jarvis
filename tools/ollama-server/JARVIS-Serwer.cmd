@echo off
REM JARVIS — Serwer Ollamy: DWUKLIKALNY launcher.
REM Plik .ps1 sam nie odpala sie dwuklikiem (Windows otwiera go w Notatniku) — ten .cmd
REM uruchamia go poprawnie, z pominieciem zasady wykonywania, i NIE zamyka okna po bledzie.
setlocal
title JARVIS - Serwer Ollamy
echo Uruchamiam serwer Ollamy dla JARVIS-a...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jarvis-ollama-server.ps1"
echo.
echo (Okno mozesz zamknac. Jesli cos poszlo nie tak, zrob zrzut ekranu.)
pause
