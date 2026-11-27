# JARVIS — PRZEWODNIK PRZEKAZANIA I ODBIORU NA FIZYCZNYM UBUNTU (PHYSICAL MACHINE HANDOFF)

- **Data przygotowania:** 2026-11-27
- **Plik transferowy:** `~/JARVIS-TRANSFER/JARVIS-FINAL-ACCEPTANCE.bundle` (rozmiar: `5 813 996` bajtów / `5.6M`)
- **Oczekiwana suma SHA256:** `bf3bae98cc76bff1fde8fe3e7c7c0fedd170a88c9d98273504e0e0c829dfd0da`
- **Gałęzie zawarte w bundle:**
  - `main`: `8bc8e0388539c41adad1729ae796c998becfefe8`
  - `feat/jarvis-forge-evolution`: `a6b8bd6ae39ccdb07de2496c0e7882a274863952` (`22` commity ponad `main`, pełna historia)
- **Status weryfikacji źródłowej:** `git bundle verify` = **`okay`** (`The bundle records a complete history`), `sha256sum` = **`OK`**

> **Uwaga dotycząca `TRANSFER-README.txt`:** plik `~/JARVIS-TRANSFER/TRANSFER-README.txt` został zweryfikowany — wszystkie sumy SHA256, rozmiary i SHA commitów są w 100% spójne z bundle. Niniejszy przewodnik rozszerza go o twardą detekcję maszyny fizycznej, izolowaną instalację `npm ci` w `~/Jarvis-Acceptance`, obowiązkowy audyt RAM/dysku/GPU przed pobraniem modeli oraz diagnostykę Electron / IPC / Ollama / Forge.

---

## 1. Przeniesienie pliku na fizyczny komputer Ubuntu

Skopiuj plik `JARVIS-FINAL-ACCEPTANCE.bundle` (oraz opcjonalnie `TRANSFER-README.txt` i ten przewodnik) ze środowiska źródłowego `/home/antigravity/JARVIS-TRANSFER/` do katalogu `~/Downloads/` na fizycznym komputerze Ubuntu.

### Wybierz najwygodniejszą metodę transferu

- **Metoda A — Pobieranie przez przeglądarkę / IDE (jeśli pracujesz z panelem plików Devbox):**
  1. Otwórz ścieżkę `/home/antigravity/JARVIS-TRANSFER/JARVIS-FINAL-ACCEPTANCE.bundle` w eksploratorze plików i pobierz plik na dysk lokalny.
  2. Zapisz go jako `~/Downloads/JARVIS-FINAL-ACCEPTANCE.bundle`.
- **Metoda B — Pendrive USB:**
  1. Zapisz `JARVIS-FINAL-ACCEPTANCE.bundle` na pendrive (wymaga zaledwie ~6 MB wolnego miejsca; bezpieczne na FAT32/exFAT/ext4).
  2. Po podłączeniu pendrive'a na fizycznym Ubuntu wykonaj:
     ```bash
     mkdir -p ~/Downloads
     cp /media/"$USER"/*/JARVIS-FINAL-ACCEPTANCE.bundle ~/Downloads/
     ```
- **Metoda C — Transfer sieciowy `scp` / `rsync` (jeśli masz dostęp SSH do maszyny źródłowej):**
  ```bash
  mkdir -p ~/Downloads
  scp uzytkownik@host-zrodlowy:/home/antigravity/JARVIS-TRANSFER/JARVIS-FINAL-ACCEPTANCE.bundle ~/Downloads/
  ```

### Obowiązkowa weryfikacja po przeniesieniu (na fizycznym Ubuntu)

```bash
cd ~/Downloads
ls -lh JARVIS-FINAL-ACCEPTANCE.bundle
echo "bf3bae98cc76bff1fde8fe3e7c7c0fedd170a88c9d98273504e0e0c829dfd0da  JARVIS-FINAL-ACCEPTANCE.bundle" | sha256sum -c -
git bundle list-heads JARVIS-FINAL-ACCEPTANCE.bundle
```

**Oczekiwany wynik:**
- `JARVIS-FINAL-ACCEPTANCE.bundle: OK`
- `8bc8e0388539c41adad1729ae796c998becfefe8 refs/heads/main`
- `a6b8bd6ae39ccdb07de2496c0e7882a274863952 refs/heads/feat/jarvis-forge-evolution`

Jeśli suma SHA256 się nie zgadza — **NIE kontynuuj**, pobierz plik ponownie.

---

## 2. Jednoznaczna kontrola: fizyczny Ubuntu vs Devbox / VM / WSL

Przed rozpoczęciem odbioru uruchom na docelowym komputerze poniższy skrypt kontrolny. Jednoznacznie wykrywa on zdalny Devbox, maszyny wirtualne (`kvm`, `qemu`, `vmware`, `virtualbox`, `cloud-hypervisor`), kontenery i WSL.

```bash
bash -c '
set -u
HOST="$(hostname)"
VIRT="$(systemd-detect-virt 2>/dev/null || echo unknown)"
CHASSIS="$(hostnamectl --static >/dev/null 2>&1 && hostnamectl | awk -F: "/Chassis/{gsub(/^[ \t]+/,\"\",\$2); print \$2}" || echo unknown)"
DMI_PROD="$(cat /sys/class/dmi/id/product_name 2>/dev/null || echo unavailable)"
DMI_VEND="$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null || echo unavailable)"
KERNEL="$(uname -a)"

echo "Hostname          : $HOST"
echo "systemd-detect-virt: $VIRT"
echo "Chassis           : $CHASSIS"
echo "DMI Vendor/Product: $DMI_VEND / $DMI_PROD"
echo "Kernel            : $KERNEL"

FAIL=0
if [ "$VIRT" != "none" ]; then
  echo "❌ WYKRYTO WIRTUALIZACJĘ/KONTENER ($VIRT) — to NIE jest fizyczny komputer!"
  FAIL=1
fi
if [ "$HOST" = "devbox" ] || echo "$DMI_PROD $DMI_VEND" | grep -qiE "cloud-hypervisor|qemu|kvm|virtualbox|vmware|xen"; then
  echo "❌ WYKRYTO ŚRODOWISKO DEVBOX LUB HYPERVISOR ($HOST / $DMI_VEND $DMI_PROD)!"
  FAIL=1
fi
if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
  echo "❌ WYKRYTO WSL — wymagany natywny fizyczny Ubuntu!"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "✅ POTWIERDZONO: natywny, fizyczny komputer Linux/Ubuntu (brak VM/Devbox/WSL)."
else
  echo "⛔ STOP: uruchom odbiór bezpośrednio na fizycznym Ubuntu, nie na VM!"
  exit 1
fi
'
```

Następnie zapisz pełny profil sprzętowy (potrzebny również przed podjęciem decyzji o modelach AI):

```bash
hostnamectl
lscpu | head -n 25
free -h
df -h / ~
command -v nvidia-smi && nvidia-smi || echo "Brak NVIDIA GPU (sprawdź: lspci | grep -iE 'vga|3d|display')"
lspci 2>/dev/null | grep -iE 'vga|3d|display' || true
node -v && npm -v && git --version
```

> **Zasada:** brak GPU **nie** blokuje odbioru — sprawdź liczbę rdzeni CPU, wolny RAM i wolny dysk zanim dotkniesz jakichkolwiek modeli Ollama.

---

## 3. Import bundle do osobnego katalogu roboczego (`~/Jarvis-Acceptance`)

Poniższe polecenia tworzą całkowicie odizolowaną kopię roboczą `~/Jarvis-Acceptance`, **nie dotykając** żadnego istniejącego repozytorium Jarvisa na komputerze użytkownika.

```bash
# 1. Sprawdź, że katalog docelowy jeszcze nie istnieje (zero nadpisywania!)
test ! -e ~/Jarvis-Acceptance || { echo "⛔ ~/Jarvis-Acceptance już istnieje — wybierz inną nazwę lub sprawdź zawartość!"; exit 1; }

# 2. Utwórz puste repozytorium i zweryfikuj bundle z kompletną historią
git init ~/Jarvis-Acceptance
cd ~/Jarvis-Acceptance
git bundle verify ~/Downloads/JARVIS-FINAL-ACCEPTANCE.bundle

# 3. Zaimportuj obie gałęzie (main oraz feat/jarvis-forge-evolution) z pełną historią
git fetch ~/Downloads/JARVIS-FINAL-ACCEPTANCE.bundle \
  refs/heads/main:refs/heads/main \
  refs/heads/feat/jarvis-forge-evolution:refs/heads/feat/jarvis-forge-evolution

# 4. Przełącz się na gałąź odbiorczą (bez dotykania main!)
git checkout feat/jarvis-forge-evolution

# 5. Zweryfikuj dokładne SHA, wspólną historię i czystość drzewa
git status --short --branch
echo "HEAD : $(git rev-parse HEAD)"
echo "main : $(git rev-parse main)"
echo "ahead: $(git rev-list --count main..feat/jarvis-forge-evolution) commitów"
git log --oneline -8
```

**Oczekiwane wartości:**
- `HEAD`: `a6b8bd6ae39ccdb07de2496c0e7882a274863952`
- `main`: `8bc8e0388539c41adad1729ae796c998becfefe8`
- `ahead`: `22` commity
- `git status --short --branch`: `## feat/jarvis-forge-evolution` (czyste drzewo)

*(Opcjonalnie, wyłącznie jeśli kiedyś zdecydujesz się dodać zdalny `origin` — bez `push`: `git remote add origin https://github.com/Talent620/Jarvis.git`.)*

---

## 4. Instalacja zależności bez utraty konfiguracji użytkownika

### 4.1 Ochrona istniejących ustawień użytkownika
- Praca odbywa się w osobnym katalogu `~/Jarvis-Acceptance`, więc inne klony projektu i lokalne `.env` pozostają nietknięte.
- Aplikacja desktopowa Electron przechowuje ustawienia użytkownika w `~/.config/jarvis-ai-assistant/` (tryb `electron:dev`) lub `~/.config/JARVIS/` (paczka AppImage/DEB).
- Jeżeli masz już wcześniejszą instalację Jarvisa z własną konfiguracją, wykonaj przed startem szybką kopię zapasową (tylko odczyt/kopia):
  ```bash
  for d in ~/.config/jarvis-ai-assistant ~/.config/JARVIS; do
    [ -d "$d" ] && cp -a "$d" "${d}.backup-$(date +%Y%m%d-%H%M%S)" && echo "Kopia zapasowa: $d"
  done
  ```
- Jeśli chcesz uruchomić test Electrona całkowicie odizolowany od Twojego codziennego profilu, możesz użyć osobnego katalogu danych: `XDG_CONFIG_HOME=/tmp/jarvis-accept-config npm run electron:dev`.

### 4.2 Sprawdzenie wymagań i czysta instalacja (`npm ci`)

```bash
cd ~/Jarvis-Acceptance

# 1. Sprawdzenie środowiska Ubuntu BEZ wprowadzania zmian systemowych
npm run ubuntu:check

# 2. Sprawdzenie, czy npm nie ma wyłączonych skryptów instalacyjnych (Electron wymaga postinstall!)
npm config get ignore-scripts
# Oczekiwane: false (jeśli true, użyj: npm ci --ignore-scripts=false)

# 3. Czysta, deterministyczna instalacja z package-lock.json (NIE używaj --ignore-scripts!)
npm ci

# 4. Twarda weryfikacja binarki Electron (MUSI zwrócić pełną ścieżkę do binarki!)
node -e "console.log(require('electron'))"
ls -lh node_modules/electron/dist/electron

# 5. Build produkcyjny UI (wymagany m.in. przez forge:accept krok 6 i Electron)
npm run build
```

**Oczekiwany wynik kroku 4:**
`/home/<twoj-user>/Jarvis-Acceptance/node_modules/electron/dist/electron`

Jeśli `require('electron')` rzuci błąd — przejdź do sekcji **7.1 (Diagnostyka Electrona)** i **nie** uznawaj testu natywnego za wykonany.

---

## 5. Lokalne modele AI — NAJPIERW audyt RAM, dysku i GPU, DOPIERO POTEM decyzja

**Zasada twarda:** nie pobieraj żadnych modeli automatycznie ani w ciemno. Najpierw sprawdź, co jest już zainstalowane i na co pozwala sprzęt.

### 5.1 Sprawdzenie aktualnego stanu Ollamy i zasobów

```bash
echo "=== ZASOBY ==="
free -h
df -h ~ /var/lib/ollama 2>/dev/null || df -h ~
command -v nvidia-smi && nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv || echo "GPU: brak NVIDIA"

echo "=== OLLAMA ==="
command -v ollama && ollama --version || echo "Ollama nie jest zainstalowana"
curl -fsS http://127.0.0.1:11434/api/tags && echo "" || echo "Daemon Ollama nie odpowiada na 127.0.0.1:11434"
ollama list 2>&1 || true
```

### 5.2 Reguła decyzyjna (preferuj już zainstalowane modele!)

1. **Jeśli `ollama list` pokazuje już model kodujący/instrukcyjny** pasujący do sprzętu (np. `qwen2.5-coder:7b`, `qwen2.5-coder:14b`, `qwen3:4b-instruct-2507-q4_K_M`, `qwen2.5-coder:3b`) — **użyj istniejących modeli bez pobierania nowych**.
2. **Jeśli brak odpowiedniego modelu**, sprawdź najpierw w tabeli poniżej, czy masz wystarczająco RAM, wolnego miejsca na dysku (min. `2×` rozmiar modelu) oraz VRAM:

| Wykryty sprzęt | Minimalny wolny dysk | Zalecany model główny (Dev) | Zalecany 2. model (niezależny Reviewer) | Uwagi |
|---|---|---|---|---|
| **CPU-only, <= 8 GB RAM** | >= 10 GB | `qwen3:4b-instruct-2507-q4_K_M` (~2.5 GB) | `qwen2.5-coder:3b` (~1.9 GB) | **NIE** instaluj modeli `>= 14B` ani `qwen3:4b` (Thinking-2507)! |
| **CPU-only, 16–32 GB RAM** | >= 15 GB | `qwen2.5-coder:7b` (~4.7 GB) lub `qwen3:4b-instruct-2507-q4_K_M` | `qwen2.5-coder:3b` (~1.9 GB) | 7B daje wyraźnie wyższą jakość kodu na CPU przy 16+ GB RAM. |
| **GPU 6–8 GB VRAM** | >= 15 GB | `qwen2.5-coder:7b` (~4.7 GB) | `qwen3:4b-instruct-2507-q4_K_M` (~2.5 GB) | Szybkie pełne cykle (< 30 s). |
| **GPU 12–16 GB VRAM** | >= 25 GB | `qwen2.5-coder:14b` (~9.0 GB) | `qwen2.5-coder:7b` (~4.7 GB) | Bardzo wysoka skuteczność wieloplikowa. |
| **GPU 24+ GB VRAM** | >= 45 GB | `qwen2.5-coder:32b` (~20 GB) | `qwen2.5-coder:7b` (~4.7 GB) | Poziom bliski modelom chmurowym przy `$0.00`. |

> **Pułapka z Fazy 5 (`FA-009`):** **NIE** używaj domyślnego tagu `ollama pull qwen3:4b`, ponieważ w rejestrze wskazuje on na `Qwen3-4B-Thinking-2507`, który ignoruje `think: false` i marnuje setki tokenów na rozważania. Zawsze wybieraj jawny wariant nietrybowy **`qwen3:4b-instruct-2507-q4_K_M`** lub **`qwen2.5-coder:7b` / `14b`**.

Jeśli na maszynie nie ma odpowiedniego modelu i nie chcesz go pobierać teraz — zapisz w raporcie status **`BLOCKED`** i podaj wybraną komendę `ollama pull ...` z powyższej tabeli.

---

## 6. Procedura pełnego odbioru na fizycznym Ubuntu

### Krok 6.1 — Pełna weryfikacja repozytorium na fizycznym sprzęcie

> **Ważne:** jeśli masz <= 12 GB RAM, uruchamiaj `npm run memory:check` gdy Ollama nie trzyma załadowanych wag w RAM (albo po `ollama stop <model>`), aby uniknąć presji pamięci podczas 377 plików Vitest.

```bash
cd ~/Jarvis-Acceptance
npm run memory:check
npm run tools:verify
npm run memory:verify
npm run test:e2e:xvfb
```

Zapisz kod wyjścia (`echo $?`) dla każdego polecenia. Oczekiwane wyniki:
- `memory:check`: `secret-scan=PASS lint=PASS test=PASS (377/377, 3170/3170) build=PASS`
- `tools:verify`: exit `0`
- `memory:verify`: exit `0` (`17/17` zdarzeń)
- `test:e2e:xvfb`: `10/10 PASS`, `0` błędów CORS, `0` wyjątków JS

### Krok 6.2 — Oficjalny odbiór Forge (`npm run forge:accept`)

Upewnij się, że daemon Ollama działa (`ollama serve` lub `systemctl status ollama`) i ma co najmniej 1 odpowiedni model, po czym uruchom:

```bash
cd ~/Jarvis-Acceptance
npm run forge:accept
```

**Oczekiwany wynik na fizycznym Ubuntu:** **`7 PASS · 0 WARN · 0 FAIL`**:
1. `1_host_hardware`: `PASS` (rzeczywiste CPU/RAM/GPU fizycznego Ubuntu)
2. `2_forge_daemon_security`: `PASS` (`127.0.0.1`, `403` bez `X-Forge-Client` i dla `Origin: null`, `session=200`, `connection.json`)
3. `3_electron_integration`: **`PASS`** (mostek IPC + obecna binarka `node_modules/electron/dist/electron`)
4. `4_local_ollama`: **`PASS`** (online + wykryte modele)
5. `5_pause_resume_rollback`: `PASS`
6. `6_ui_build_artifacts`: `PASS`
7. `7_live_coding_task_local_ollama`: **`PASS`** (prawdziwy model AI, generacja kodu, testy, niezależna recenzja, zapis doświadczeń)

### Krok 6.3 — Natywny Electron i bezpośredni test IPC `jarvis:forge-ensure-local`

1. **Upewnij się, że ręczny serwer Forge NIE działa na porcie 3220** (aby przetestować realny auto-start przez Electron IPC):
   ```bash
   ss -tlnp | grep 3220 || echo "Port 3220 wolny — gotowy do testu auto-startu IPC"
   ```
2. **Uruchom natywny proces Electron:**
   ```bash
   cd ~/Jarvis-Acceptance
   npm run electron:dev
   ```
3. **Potwierdź działanie procesu Electron i `preload.cjs`:**
   - Otwórz DevTools w oknie Electron (`Ctrl+Shift+I`), przejdź do zakładki **Console** i wykonaj:
     ```js
     Boolean(window.jarvisDesktop && typeof window.jarvisDesktop.ensureLocalForge === "function")
     ```
     Oczekiwany wynik: `true`.
4. **Bezpośredni test IPC `jarvis:forge-ensure-local`:**
   - W tej samej konsoli DevTools wykonaj:
     ```js
     await window.jarvisDesktop.ensureLocalForge("http://127.0.0.1:3220")
     ```
   - **Oczekiwany wynik:** obiekt `{ ok: true, started: true, url: "http://127.0.0.1:3220", token: "<48-znakowy hex>" }` (lub `started: false`, jeśli panel Forge został już wcześniej otwarty i zdążył uruchomić daemona).
5. **Potwierdź działanie w systemie operacyjnym (drugi terminal):**
   ```bash
   ps aux | grep -E "electron|forge/server.mjs" | grep -v grep
   curl -fsS http://127.0.0.1:3220/api/health
   ls -la ~/.config/jarvis-ai-assistant/jarvis-forge/runtime/connection.json
   ```
6. **Otwórz `ForgeWorkspace` w oknie Electron:**
   - Naciśnij **`Ctrl+K`**, wpisz `forge` i wybierz **„Jarvis Forge — autonomiczne programowanie”**.
   - Stopka panelu musi pokazać `Autopilot gotowy · N darmowych modeli · Koszt: $0.00`.
   - Zakładka **„🧠 Modele i pamięć”** musi wyświetlić realne parametry sprzętowe Twojego Ubuntu i zielony status `🟢` dla Ollamy.

### Krok 6.4 — Prawdziwy test programistyczny użytkownika end-to-end przez UI

1. **Przygotuj czyste, izolowane repozytorium testowe modułu faktur w `/tmp/jarvis-ubuntu-invoice-test`:**
   ```bash
   rm -rf /tmp/jarvis-ubuntu-invoice-test
   mkdir -p /tmp/jarvis-ubuntu-invoice-test/src /tmp/jarvis-ubuntu-invoice-test/test
   cat > /tmp/jarvis-ubuntu-invoice-test/package.json <<'EOF'
   {
     "name": "invoice-module-acceptance",
     "type": "module",
     "scripts": { "test": "node --test" }
   }
   EOF
   cat > /tmp/jarvis-ubuntu-invoice-test/src/invoice.mjs <<'EOF'
   export function calculateInvoice(subtotal, discountPercent = 0, vatRate = 0.23) {
     const discounted = subtotal * (1 + discountPercent / 100);
     const net = Math.max(0, discounted);
     const vat = Math.round((net * vatRate + Number.EPSILON) * 100) / 100;
     const total = Math.round((net + vat + Number.EPSILON) * 100) / 100;
     return { net: Math.round((net + Number.EPSILON) * 100) / 100, vat, total };
   }
   EOF
   cat > /tmp/jarvis-ubuntu-invoice-test/test/invoice.test.mjs <<'EOF'
   import test from "node:test";
   import assert from "node:assert/strict";
   import { calculateInvoice } from "../src/invoice.mjs";

   test("10% discount reduces net and VAT is computed after discount", () => {
     const r = calculateInvoice(100, 10, 0.23);
     assert.equal(r.net, 90);
     assert.equal(r.vat, 20.7);
     assert.equal(r.total, 110.7);
   });

   test("100% discount results in 0 net, 0 vat, 0 total", () => {
     const r = calculateInvoice(150, 100, 0.23);
     assert.equal(r.net, 0);
     assert.equal(r.vat, 0);
     assert.equal(r.total, 0);
   });
   EOF
   git -C /tmp/jarvis-ubuntu-invoice-test init -q
   git -C /tmp/jarvis-ubuntu-invoice-test config user.email "accept@jarvis.local"
   git -C /tmp/jarvis-ubuntu-invoice-test config user.name "Ubuntu Acceptance"
   git -C /tmp/jarvis-ubuntu-invoice-test add .
   git -C /tmp/jarvis-ubuntu-invoice-test commit -q -m "initial buggy invoice module"
   node --test /tmp/jarvis-ubuntu-invoice-test/test/invoice.test.mjs || echo "Potwierdzono startowy FAIL testów"
   ```

2. **Zleć zadanie w UI Jarvisa (`ForgeWorkspace` w oknie Electron):**
   - Kliknij **`⚙ Opcje`** i w polu **Katalog repozytorium** wpisz: `/tmp/jarvis-ubuntu-invoice-test`.
   - W polu polecenia wklej dokładnie:
     > `Przeanalizuj moduł faktur, znajdź błędy i popraw je. Nie zmieniaj testów. Na koniec uruchom testy i pokaż mi wynik`
   - Kliknij **`▶ Uruchom Autopilot`**.

3. **Sprawdź pełną ścieżkę + pauzę i wznowienie:**
   - Potwierdź w UI widoczność aktywnego zadania, rzeczywistego modelu (`ollama/...`), postępu `%` oraz przycisków `⏸ Pauza (checkpoint)` i `⏹ Przerwij`.
   - Kliknij **`⏸ Pauza (checkpoint)`** → poczekaj na status **`PAUSED`** (`Wstrzymano (zapisany checkpoint)`) i upewnij się, że nie ma fałszywego `PASS`.
   - Kliknij **`▶ Wznów z checkpointu`** → potwierdź, że UI natychmiast wznawia aktualizację na żywo (SSE) bez zamarzania aż do **`Zakończono sukcesem (PASS)`**.
   - Zweryfikuj w UI: diff pliku `src/invoice.mjs`, zielony wynik `npm test (exit 0)`, niezależną recenzję `(niezależny cross-model ✓)` (przy >= 2 modelach w Ollamie) oraz zapis doświadczenia w zakładce **„🧠 Modele i pamięć”**.

4. **Niezależna weryfikacja w terminalu:**
   ```bash
   git -C /tmp/jarvis-ubuntu-invoice-test status --short
   git -C /tmp/jarvis-ubuntu-invoice-test diff
   git -C /tmp/jarvis-ubuntu-invoice-test diff test/invoice.test.mjs   # MUSI być puste!
   node --test /tmp/jarvis-ubuntu-invoice-test/test/invoice.test.mjs  # MUSI zwrócić 2/2 PASS!
   ```

5. **Zapisz wynik odbioru** w `docs/JARVIS_PHYSICAL_UBUNTU_ACCEPTANCE.md` (każdy punkt jawnie oznaczony jako `PASS` / `FAIL` / `BLOCKED` / `NOT RUN` oraz końcowa decyzja `READY FOR MERGE` albo `NOT READY`).

---

## 7. Diagnostyka najczęstszych błędów na fizycznym Ubuntu

### 7.1 Electron
| Objaw / Błąd | Przyczyna | Rozwiązanie |
|---|---|---|
| `Error: Electron failed to install correctly` | `npm ci` uruchomione z `ignore-scripts=true` lub przerwane pobieranie binarki | `npm config set ignore-scripts false && rm -rf node_modules/electron && npm ci && node -e "console.log(require('electron'))"` |
| `The SUID sandbox helper binary was found, but is not configured correctly` lub `FATAL:setuid_sandbox_host.cc` (Ubuntu 24.04 AppArmor) | Ubuntu 24.04 domyślnie blokuje nieuprzywilejowane user namespaces dla binarek bez profilu AppArmor | Diagnostycznie: `npx electron --no-sandbox .` (lub nadanie `chmod 4755 node_modules/electron/dist/chrome-sandbox` z właścicielem `root:root` w środowisku deweloperskim). |
| `error while loading shared libraries: libgtk-3.so.0 / libnss3.so / libgbm.so.1 / libasound.so.2` | Brak bibliotek graficznych/audio wymaganych przez Chromium/Electron | `sudo apt-get update && sudo apt-get install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libatspi2.0-0 libuuid1 libgbm1 libasound2t64 xdg-utils` (lub `npm run ubuntu:setup`). |
| Czarne okno Electrona na Wayland / NVIDIA | Konflikt akceleracji GPU z sesją Wayland | Uruchom diagnostycznie: `npx electron --disable-gpu .` lub wymuś XWayland: `ELECTRON_OZONE_PLATFORM_HINT=x11 npm run electron:dev`. |

### 7.2 Ollama i lokalne modele
| Objaw / Błąd | Przyczyna | Rozwiązanie |
|---|---|---|
| `4_local_ollama: WARN` / `ECONNREFUSED 127.0.0.1:11434` | Usługa `ollama` nie działa | Sprawdź `systemctl status ollama` lub uruchom ręcznie: `OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NUM_PARALLEL=1 ollama serve`. |
| `Error: listen tcp 127.0.0.1:11434: bind: address already in use` | Daemon `ollama` już działa jako usługa systemd | Nie uruchamiaj drugiego `ollama serve`; sprawdź `curl -s http://127.0.0.1:11434/api/tags`. |
| Model działa na CPU mimo obecnej karty NVIDIA | Brak sterownika NVIDIA / CUDA lub przestarzały sterownik | Sprawdź `nvidia-smi` i `journalctl -u ollama -n 40`; po instalacji sterownika zrestartuj `sudo systemctl restart ollama`. |
| Bardzo długie odpowiedzi / timeout na `qwen3:4b` | Tag `qwen3:4b` to `Thinking-2507` ignorujący `think: false` | Zastąp przez `ollama pull qwen3:4b-instruct-2507-q4_K_M` lub (przy >= 8 GB VRAM / 16 GB RAM) `ollama pull qwen2.5-coder:7b`. |
| Błąd OOM / brak miejsca przy pobieraniu modelu | Za mało RAM/VRAM lub wolnego dysku | Usuń zbędny model (`ollama rm <nazwa>`), sprawdź `free -h && df -h` i dobierz mniejszy wariant z tabeli w sekcji 5.2. |

### 7.3 IPC `jarvis:forge-ensure-local`
| Objaw / Błąd | Przyczyna | Rozwiązanie |
|---|---|---|
| `window.jarvisDesktop` jest `undefined` | Aplikacja otwarta w zwykłej przeglądarce zamiast w oknie Electron albo błąd ładowania `electron/preload.cjs` | Uruchom `npm run electron:dev` i sprawdź terminal pod kątem błędów `preload.cjs`. |
| `{ ok: false, error: "forbidden" }` | Wywołanie IPC z nieautoryzowanego pochodzenia (ochrona `isTrustedIpc` w `electron/main.cjs:465`) | Wywołuj wyłącznie z głównego okna aplikacji (Vite dev lub lokalny `dist/index.html`). |
| `{ ok: false, error: "Brak modułu forge/server.mjs w instalacji." }` | Niekompletna kopia repo lub uszkodzona ścieżka `forge/server.mjs` | Sprawdź `ls -la ~/Jarvis-Acceptance/forge/server.mjs` i `git status`. |
| `{ ok: false, error: "JARVIS Forge zakończył pracę (kod ...)" }` | Błąd uruchomienia `forge/server.mjs` przez `ELECTRON_RUN_AS_NODE=1` | Uruchom ręcznie `node forge/server.mjs` w terminalu, aby zobaczyć pełny stacktrace błędu. |

### 7.4 Lokalny serwer Forge (`127.0.0.1:3220`)
| Objaw / Błąd | Przyczyna | Rozwiązanie |
|---|---|---|
| `Port JARVIS Forge (3220) jest zajęty przez inną usługę` | Stary proces lub inna aplikacja nasłuchuje na `:3220` | Sprawdź właściciela portu: `ss -tlnp \| grep 3220` i zatrzymaj kolidujący proces przed ponownym startem. |
| `HTTP 403 Odmowa sesji — wymagany zaufany lokalny klient` | Brak nagłówka `X-Forge-Client: jarvis-ui` lub żądanie z `Origin: null` / obcego hosta | To zamierzone zabezpieczenie anty-CSRF/DNS-rebinding (`forge/server.mjs`); używaj oficjalnego UI, CLI albo dodaj `-H "X-Forge-Client: cli"`. |
| `HTTP 401 Wymagany poprawny token X-Forge-Token` | Token sesyjny wygasł po restarcie serwera Forge | Kliknij `↻ Połącz ponownie` w UI (albo pobierz świeży token z `connection.json` / `GET /api/session`). |
| `status: blocked` (`no_free_provider`) | Brak dostępnej Ollamy i brak darmowego klucza API Kat. B | Uruchom `ollama serve` z modelem z sekcji 5.2 lub ustaw darmowy klucz (`GEMINI_API_KEY` / `GROQ_API_KEY` / `CEREBRAS_API_KEY`). Jarvis **celowo** nie uruchamia płatnych API bez Twojej zgody. |
