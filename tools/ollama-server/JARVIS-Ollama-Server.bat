@echo off
REM JARVIS — Serwer Ollamy (wersja .bat, bez kompilacji EXE).
REM Dwuklik uruchamia ten sam launcher PowerShell co EXE. Gdyby antywirus
REM blokował EXE — uzyj tego pliku. Model mozesz podac jako argument.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jarvis-ollama-server.ps1" %*
