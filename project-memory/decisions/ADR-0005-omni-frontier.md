# ADR-0005: JARVIS OMNI-FRONTIER — Hybrydowe Drzewo UI (AT-SPI2/UIA), Dual-Track Strażnik Ekranu i Diagnostyka Systemu

Status: proposed
Data: 2026-11-24
Autor: antigravity
Zakres: `electron/ui-tree.cjs`, `electron/desktop-doctor.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `src/lib/desktop.ts`, `src/lib/omniSentinel.ts`, `src/lib/omniPilot.ts`, `src/lib/omniReflex.ts`, `src/components/OmniPilotHud.tsx`, `src/lib/tools.ts`, `src/lib/toolSelector.ts`, `src/lib/permissions.ts`, `src/lib/selfManifest.ts`, `src/App.tsx`, `src/styles/index.css`

## Kontekst
Po wdrożeniu podstawowego silnika OMNI-PILOT (`ADR-0004`) zidentyfikowano trzy kluczowe ograniczenia produktu końcowego:
1. Namierzanie wyłącznie wizyjne (zrzut ekranu → VLM) kosztuje tokeny i 1–3 s opóźnienia nawet dla standardowych przycisków okien systemowych.
2. Użytkownik potrzebuje równoległego trybu towarzysza (*Dual-Track*): rozmowy w tle jak z kumplem, podczas gdy JARVIS obserwuje ekran pod kątem ustalonego warunku i pyta głosem o decyzję, gdy warunek się pojawi.
3. Polecenia diagnostyczne („sprawdź system”, „czemu nie działa dźwięk”, „co obciąża komputer”) potrzebują twardych, odczytanych faktów OS zamiast zgadywania z samego obrazu ekranu.

## Decyzja
1. **Hybrydowe namierzanie (Drzewo OS → Wizja AI):** dodano `electron/ui-tree.cjs` (Linux AT-SPI2 via `python3` + Windows UI Automation via PowerShell, wyłącznie `execFile`, zero nowych zależności npm) z dopasowaniem polsko-angielskich synonimów UI i flagą `isPassword`. `visualLocateAndAct` najpierw odpytuje lokalne drzewo OS (<80 ms, 0 USD, natychmiastowa blokada RiskGuard na polach haseł bez robienia zrzutu), a przy braku węzła automatycznie spada do AutoCore Visual Grounding `[0..1000]`.
2. **Dual-Track Strażnik Ekranu (`src/lib/omniSentinel.ts`):** nieblokujący obserwator ekranu w tle z szybkim pre-filtrem klatek O(1) (`computeFrameFingerprint` → statyczny ekran = 0 wywołań LLM / 0 USD), twardym limitem sprawdzeń (`maxChecks ≤ 60`, brak nieograniczonych pętli płatnych), proaktywnym pytaniem głosowym i kartą decyzji na HUD oraz selektywnym przechwytywaniem wyłącznie wyraźnych decyzji głosowych (zwykła rozmowa „KUMPEL” płynie dalej równolegle).
3. **Read-Only Diagnostyka „Znajdź i Napraw” (`electron/desktop-doctor.cjs`):** zbiera twarde fakty OS (dźwięk PipeWire/PulseAudio, dysk, top procesy CPU/RAM, porty TCP, `journalctl`, gotowość AT-SPI2/xdotool/Ollama) i zwraca bezpieczne `fixHint` bez nieautoryzowanego modyfikowania systemu.
4. **Twarde granice bezpieczeństwa utrzymane:** brak omijania anti-cheatów gier online, brak wstrzykiwania w pamięć procesów, brak omijania CAPTCHA, bezwzględna blokada haseł/2FA/kluczy w RiskGuard oraz master Kill-Switch `Ctrl+Alt+X` zatrzymujący jednocześnie OMNI-PILOT i Strażnika Ekranu.

## Konsekwencje
- Zerowa liczba nowych zależności w `package.json`; pełna zgodność z ES2019 / Chrome 79.
- 4 nowe jawnie sklasyfikowane narzędzia (`desktop_ui_tree`, `desktop_diagnose`, `desktop_sentinel_start`, `desktop_sentinel_stop`).
- Rzeczywiste odpytanie AT-SPI2 / Windows UIA na żywym serwerze graficznym ma status `UNKNOWN` do testu na komputerze użytkownika (VM bezgłowa).
- Wymaga recenzji właściciela lub innego agenta przed scaleniem z `main`.
