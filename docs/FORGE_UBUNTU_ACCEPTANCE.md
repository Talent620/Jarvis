# JARVIS FORGE — Procedura odbioru na fizycznym komputerze Ubuntu

Ten dokument opisuje **powtarzalną procedurę walidacji docelowego środowiska użytkownika (fizyczny PC z Ubuntu)** — wyraźnie oddzieloną od parametrów środowiska VM (2 vCPU / 8 GB RAM / brak GPU).

## 1. Wymagania wstępne na docelowym Ubuntu

- Node.js 22 (`node -v`), Git (`git --version`)
- Dla trybu **Category A (Local Free — 0 USD offline)**:
  ```bash
  curl -fsSL https://ollama.com/install.sh | sh
  ollama serve &
  # Dobierz model do rzeczywistego VRAM z `nvidia-smi`:
  # >= 16-24 GB VRAM: ollama pull qwen2.5-coder:14b && ollama pull qwen3:8b
  # 6-12 GB VRAM:     ollama pull qwen2.5-coder:7b
  # CPU only:         ollama pull qwen2.5-coder:3b
  ```
- Dla trybu **Category B (API Free — 0 USD)**: opcjonalne darmowe klucze w Ustawieniach Jarvisa lub zmiennych środowiskowych (`GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`).
- Dla trybu **Category C (Promotional Credits — np. Modal)**: aktywny profil `modal profile current` z potwierdzonym `Billed Cost: $0.00` oraz **obowiązkowym** limitem eksperymentu, limitem całkowitym i limitem czasu.

## 2. Automatyczny odbiór jednym poleceniem

```bash
npm run build
npm run forge:accept
```

Skrypt [scripts/forge-ubuntu-acceptance.mjs](file:///home/antigravity/Talent620/Jarvis/scripts/forge-ubuntu-acceptance.mjs) weryfikuje kolejno 7 bramek na docelowym sprzęcie:

1. **Rzeczywiste zasoby hosta** — CPU, RAM, `nvidia-smi` (GPU/VRAM), wersja Ubuntu, sesja X11/Wayland, wolne miejsce na dysku i automatycznie dobrany profil (`cpu_light` / `cpu_heavy` / `gpu_entry` / `gpu_mid` / `gpu_pro`).
2. **Daemon Forge i bezpieczeństwo loopback** — start na `127.0.0.1`, zapis `connection.json`, odrzucanie żądań bez `X-Forge-Client` (403) i z `Origin: null` (403), poprawna sesja tokenowa.
3. **Integracja Electron** — obecność `electron/local-forge.cjs`, mostka IPC `ensureLocalForge` w `preload.cjs` / `main.cjs` oraz natywnej binarki Electron w `node_modules/electron/dist/electron`.
4. **Lokalna Ollama** — live probe `http://127.0.0.1:11434/api/tags` i lista realnie zainstalowanych modeli.
5. **Przerwanie, checkpoint, wznowienie i rollback** — prawdziwe wstrzymanie w trakcie edycji, wznowienie z dysku i 100% cofnięcie pliku ze snapshotu.
6. **Artefakty interfejsu UI** — obecność produkcyjnego chunku `ForgeWorkspace`.
7. **Prawdziwe zadanie programistyczne na lokalnej Ollamie** — izolowane repozytorium Git w `/tmp`, naprawa błędu i potwierdzenie przez `node --test`.

## 3. Manualny odbiór Electron + UI na pulpicie Ubuntu

1. Uruchom aplikację desktopową: `npm run desktop` (lub zbudowany AppImage/deb).
2. Otwórz **Centrum funkcji → ⚒ Jarvis Forge** (lub `Ctrl+K → Jarvis Forge`).
3. Potwierdź, że bez ręcznego uruchamiania serwera status na dole okna przechodzi na **`Połączono`** (Electron auto-start przez `ensureLocalForge`).
4. Przejdź do zakładki **`Pamięć i modele`**:
   - potwierdź, że sekcja **Wykryty sprzęt** pokazuje rzeczywiste parametry Twojego PC (CPU/RAM/GPU), a nie VM;
   - potwierdź, że lokalna Ollama i/lub skonfigurowane darmowe klucze mają status `ready`.
5. W zakładce **`Zadanie`** uruchom testowe zadanie na repozytorium testowym, kliknij **`Pauza`** w trakcie pracy, a następnie **`Wznów`** i na końcu **`Cofnij zmiany (Rollback)`** — sprawdź `git status` w repozytorium (powinno być czyste).
