# JARVIS — Serwer Ollamy (PC → telefon)

Jednoklikowy launcher: na PC stawia **Ollamę** dostępną dla telefonu i daje **gotowy adres**
do wklejenia w JARVIS (⚙ → AI → „Lokalny model — adres Ollama").

## Pobierz (gotowy EXE, stały link)

**`https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS-Ollama-Server.exe`**

Dwuklik → skrypt sam:
1. ustawia Ollamę na nasłuch w sieci LAN (`OLLAMA_HOST=0.0.0.0`) + CORS (`OLLAMA_ORIGINS=*`),
2. otwiera port 11434 w zaporze (jeśli uruchomisz „jako administrator"),
3. startuje serwer i pobiera model (domyślnie `llama3.2`),
4. **pokazuje i kopiuje do schowka adres** typu `http://192.168.0.10:11434`.

Wklej ten adres w JARVIS na telefonie (APK). **Zostaw okno otwarte** — zamknięcie zatrzymuje serwer.

> SmartScreen/antywirus może ostrzec (EXE jest niepodpisany, jak `JARVIS.exe`) — „Więcej informacji → Uruchom mimo to".
> Alternatywa bez EXE: pobierz repo i odpal `JARVIS-Ollama-Server.bat` (robi to samo przez PowerShell).

## Wymagania
- Windows + [Ollama](https://ollama.com) (launcher spróbuje doinstalować przez `winget`).
- Telefon i PC w **tej samej sieci Wi-Fi** (użyj **APK**, nie przeglądarki — `http://` w LAN).
- Poza domem: [Tailscale](https://tailscale.com) na PC i telefonie → użyj adresu `100.x.y.z`.

## Inny model
Uruchom z argumentem, np. `JARVIS-Ollama-Server.exe qwen2.5` albo `... llama3.1`.
