# JARVIS — KOŃCOWY RAPORT ODBIORU FAZY 5 (FINAL ACCEPTANCE)

**Data odbioru:** 2026-11-27  
**Gałąź robocza:** `feat/jarvis-forge-evolution`  
**Gałąź `main`:** `8bc8e0388539c41adad1729ae796c998becfefe8` (**nietknięta** — brak `git push`, brak `git merge`)  
**Środowisko odbioru zdalnego:** VM KVM (`devbox`, Cloud Hypervisor, Ubuntu 24.04.5 LTS, 2 vCPU, 7.8 GB RAM, brak GPU, brak binarki Electron)  
**Koszt zewnętrzny (out-of-pocket) Fazy 5 i zamknięcia:** **`$0.00`** (`0` płatnych API, `0` nowych kontenerów Modal GPU)

> **Zasada absolutnej uczciwości:** raport rozróżnia twardo **fakty z dowodem** (commit, log, kod wyjścia, raport w `project-memory/reports/`) od elementów niezweryfikowanych w VM (`NOT RUN` / `WARN`). Wyniki `PAUSED` i `BLOCKED` nigdy nie są liczone jako `PASS`. Środowisko VM nigdy nie jest utożsamiane z fizycznym komputerem Ubuntu użytkownika.

---

## A. Stan projektu

### A.1 Rzeczywisty stan Git (zweryfikowany bezpośrednio)
- **Gałąź robocza:** `feat/jarvis-forge-evolution`
- **Gałąź `main`:** `8bc8e0388539c41adad1729ae796c998becfefe8` (niezmodyfikowana)
- **Drzewo robocze:** czyste przed zamknięciem i czyste po zatwierdzeniu zmian (bez `git push`, bez `git merge`, bez resetów i bez usuwania gałęzi)
- **Sprawdzenie historycznego stanu po Fazie 5:**
  - `f2ba49b` (`docs(forge): add Phase 5 Real Autonomy report and FA-009 live Ollama findings`) — ostatni commit kodu/dokumentacji Fazy 5.
  - `8867109` (`docs(memory): record jarvis-forge-phase5-real-autonomy event & verified CURRENT_STATE (377/377, 3169/3169)`) — zapis zweryfikowanego stanu po `npm run memory:check` (log `task-5423.log`, exit `0`; `git diff --stat f2ba49b..8867109` obejmował wyłącznie 7 plików w `project-memory/`).
- **Wykryte i naprawione realne usterki w trakcie odbioru końcowego — commit `ce42434` (`ce42434851d0dc6fbce5637cda86ba53086b5`):**
  1. **Krytyczny błąd `isReadOnlyGoal` dla polskich poleceń złożonych (`forge/engine.mjs`):** wzorzec `^\s*(?:przeanalizuj|oceń|wyjaśnij)` klasyfikował codzienne polecenie *„Przeanalizuj moduł faktur, znajdź błędy i popraw je. Nie zmieniaj testów. Na koniec uruchom testy i pokaż mi wynik”* jako zadanie `read-only` (bo zaczyna się od „Przeanalizuj”), co wyłączało baseline scout, preloading, bramkę `change-check` (`no-files-modified`) i `completeness-gate` — grożąc fałszywym `PASS` bez edycji kodu. Naprawiono przez analizę `goalRequestsCodeChanges` na `goalWithoutNegative` (z obsługą polskich znaków diakrytycznych i fraz negatywnych).
  2. **Wyścig stanu przy wznawianiu/zatwierdzaniu w HTTP + UI (`forge/autopilot.mjs`, `forge/server.mjs`, `src/lib/forgeClient.ts`, `src/components/ForgeWorkspace.tsx`):** `POST /api/runs/:id/resume` i `POST /api/autopilot/:id/decide` zwracały `202` zanim status na dysku zmienił się z `paused`/`waiting_approval` na aktywny (`queued`), przez co `ForgeWorkspace` nie uruchamiał subskrypcji SSE po kliknięciu `▶ Wznów z checkpointu` / `✅ Zatwierdź i wykonaj`. Dodano synchroniczny zapis statusu `queued`, zwracanie aktualnego `run` w `202`, ochronę `409` przed podwójnym `resume`, przejście stanu w UI oraz `try/catch` z komunikatami błędów dla `pause/cancel/resume/rollback`.
  3. **Deterministyczna synchronizacja `cancel` w teście `Scenariusz 4` (`tests/jarvisPhase4Autopilot.test.ts`):** zastąpiono ślepy `setTimeout(150)` obietnicą `call2Started`, ponieważ po dodaniu baseline test scouta w Fazie 5 `cancel` trafiał w fazę `scouting`, przez co test dobijał do `4951–5077 ms` względem limitu `5000 ms` Vitest. Bez osłabiania jakiejkolwiek asercji czas spadł do `1245 ms` i test gwarantuje przerwanie `AbortSignal` w trakcie aktywnego wywołania LLM.
  4. **Nowy test regresyjny #9 (`tests/jarvisPhase5Resilience.test.ts`):** pokrywa dokładnie polskie polecenie z §5 (odrzucenie no-op `finish_task`, blokadę edycji chronionego testu, naprawę `src/invoice.mjs`, niezależną recenzję, odróżnienie czystego read-only oraz HTTP `202` `/resume` ze statusem `queued`).

### A.2 Łańcuch commitów Fazy 5 i odbioru końcowego na `feat/jarvis-forge-evolution`
| Commit | Opis |
|---|---|
| `d0797c0` | `fix(forge,ui): Phase 5 real-autonomy hardening, KV-cache, loop breaker, TAP/JSON parsers & test-protection review alignment` |
| `6a4e1f5` | `test(forge): add Phase 5 resilience and live-regression test suite (8 tests)` |
| `f2ba49b` | `docs(forge): add Phase 5 Real Autonomy report and FA-009 live Ollama findings` |
| `8867109` | `docs(memory): record jarvis-forge-phase5-real-autonomy event & verified CURRENT_STATE (377/377, 3169/3169)` |
| `ce42434` | `fix(forge,ui): fix compound analyze-and-fix read-only bug, HTTP/UI resume SSE race & Scenario 4 cancel sync` |
| *(kolejny commit)* | `docs(acceptance): add final Phase 5 closeout acceptance report (docs/JARVIS_FINAL_ACCEPTANCE.md)` |
| *(końcowy commit)* | `docs(memory): record jarvis-forge-phase5-closeout-acceptance event & verified CURRENT_STATE` |

---

## B. Wyniki kontroli

### B.1 Weryfikacja deterministyczna, budowanie i testy UI na kodzie po poprawkach (`ce42434`)

| Kontrola | Polecenie / Źródło | Wynik | Twardy dowód |
|---|---|---|---|
| **Skan sekretów (całe repo)** | `node scripts/secret-scan.mjs --all` | **`PASS`** | exit `0` — `Skan sekretów: czysto.` |
| **Pakiety Forge + Autopilot + Phase 5** | `npx vitest run tests/jarvisPhase5Resilience.test.ts tests/jarvisPhase4Autopilot.test.ts tests/jarvisForgeEvolution.test.ts tests/jarvisForgeAdaptive.test.ts tests/jarvisForgePhase2Hardening.test.ts` | **`PASS`** | **5/5 plików · 36/36 testów PASS** (`42.58 s`, Scenariusz 4: `1245 ms`, nowy test #9: `3010 ms`) |
| **TypeScript + Vite build** | `npm run build` (`tsc -b && vite build`) | **`PASS`** | exit `0`, Vite `built in 15.03s`, obecny chunk `ForgeWorkspace` w `dist/assets` |
| **Weryfikacja narzędzi VM** | `npm run tools:verify` | **`PASS`** | exit `0` (`11/12` aktywnych narzędzi `true`: files, git, terminal, http, browser, docker, sqlite, izolacja `generated_tool`; `postgres: null` = brak klienta `psql`) |
| **E2E przeglądarka + Xvfb + X11** | `npm run test:e2e:xvfb` | **`PASS`** | **10/10 PASS**, `0` błędów CORS, `0` wyjątków JS (z jawną informacją o braku binarki Electron w VM) |
| **Żywa sonda UI `ForgeWorkspace` w Chrome (CDP)** | Prawdziwy `forge/server.mjs` + Vite + Google Chrome (Xvfb) | **`PASS`** | Otwarcie przez `Ctrl+K`, polskie polecenie z §5, widoczny cel/model/postęp/przyciski `Pauza` i `Przerwij` → `PAUSED` bez fałszywego sukcesu → kliknięcie `▶ Wznów z checkpointu` → żywa aktualizacja SSE do `Zakończono sukcesem (PASS)`, diff `src/invoice.mjs`, `1/1 PASS`, `(niezależny cross-model ✓)`, `↩ Cofnij zmiany`, karta `waiting_approval` dla `git push origin main`, **`0` wyjątków JS** |
| **Odbiór Ubuntu kroki 1–6 na `ce42434`** | `node scripts/forge-ubuntu-acceptance.mjs --skip-live-task` | **`PASS` (4 PASS, 3 WARN, 0 FAIL)** | PASS: hardware, daemon security (`403` bez klienta / `Origin:null`), pause/resume/rollback, `dist/` build; WARN: brak binarki Electron w VM, daemon Ollama zatrzymany na czas Vitest, krok 7 pominięty (zweryfikowany na żywo w `task-5269`) |
| **Pełna bramka repo (`memory:check`)** | `npm run memory:check` (`secret-scan`, `lint`, pełny Vitest **377/377 plików · 3170/3170 testów**, `build`) + `npm run memory:verify` | **Uruchamiane na czystym drzewie natychmiast po commicie niniejszego raportu** | Historyczny punkt bazowy `f2ba49b` (`task-5423.log`): `secret-scan=PASS`, `lint=PASS (0 errors, 2 warnings)`, `test=PASS (377/377, 3169/3169, 333 s)`, `build=PASS (41 s)`. Świeży wynik dla finalnego HEAD z `ce42434` zapisywany jest w `project-memory/CURRENT_STATE.md` i `project-memory/reports/*.json`. |
| **Android APK** | `android-v2.yml` (GitHub Actions) | **`NOT RUN` (`STALE`)** | Zbudowany na `2afee4f`; nie uruchamiano zgodnie z zakazem `push` i brakiem zmian Androida |

### B.2 Uczciwy audyt WSZYSTKICH testów Live AI (lokalna Ollama `v0.40.18`, 2 vCPU CPU-only, `$0.00`)

Audyt objął bezpośrednio wszystkie surowe logi wykonań (`task-5269`, `task-5273`, `task-5282`, `task-5311`, `task-5332`, `task-5336`, `task-5345`, `task-5350`).

> **Uwaga audytorska do wcześniejszego raportu:** w tabeli §6 pliku `docs/JARVIS_PHASE5_REAL_AUTONOMY.md` pominięto osobny wiersz dla testu **Live AI #2 (`inventory`, `task-5273`, wynik `PAUSED`)**. Poniższa tabela zawiera **kompletne zestawienie wszystkich 6 nazwanych testów Live AI + oficjalny krok 7 `forge:accept`** bez żadnych pominięć.

| # | Nazwa testu Live AI | Log źródłowy | Interfejs i tryb | Modele (prawdziwe, `$0.00`) | Czas / Iter. | Niezależny `node --test` | Werdykt końcowy | Rzeczywisty powód wyniku / zatrzymania |
|---|---|---|---|---|---|---|---|---|
| **0** | **`forge:accept` krok 7 (`sumPositive`)** | `task-5269.log` | `scripts/forge-ubuntu-acceptance.mjs` | Dev: `qwen2.5-coder:3b`<br>Rev: `qwen3:4b-instruct-2507-q4_K_M` | `113.9 s` · 3 iter. | **PASS** (exit 0) | **`PASS`** | Pełny cykl autonomiczny + niezależna recenzja cross-model i ochrona `math.test.mjs`. |
| **1** | **`invoice-engine`** (`src/pricing.mjs` + `src/invoice.mjs`, 3 błędy) | `task-5282.log` *(oraz powtórka `task-5336.log`)* | `executeAutopilotMission` + auto `git worktree` | `task-5282`: `qwen2.5-coder:3b` → rotacja → `qwen3:4b-instruct-2507-q4_K_M`<br>`task-5336`: `qwen3:4b-instruct-2507-q4_K_M` | `540.2 s` · 8 iter. (`540.1 s` · 4 iter.) | **FAIL** (repo bazowe nietknięte) | **`PAUSED`** *(NIE PASS)* | Osiągnięto limit czasu `540 s` (`time_limit`). W `task-5282` udowodniono żywą detekcję no-op i rotację `3B → 4B`; model 4B potknął się o wieloblokowe dopasowanie `search` w `src/pricing.mjs` (wiersze 14/17). |
| **2** | **`inventory`** (`src/inventory.mjs`, 3 błędy maszyny stanów) | `task-5273.log` | **CLI:** `node forge/cli.mjs autopilot` | `qwen2.5-coder:3b` → rotacja → `qwen3:4b-instruct-2507-q4_K_M` | `360.3 s` | **FAIL** (`cliExitCode: 1`) | **`PAUSED`** *(NIE PASS)* | `qwen2.5-coder:3b` 3× nie dopasowało `search` w `edit_file` → detektor pętli przełączył na `qwen3:4b-instruct` → limit czasu `360 s` (`time_limit`), zapisano `1` nieudaną próbę w pamięci. |
| **3** | **`discount`** (`src/discount.mjs`, 3 błędy jednocześnie) | `task-5311.log` | **CLI:** `node forge/cli.mjs autopilot` | `qwen2.5-coder:3b` → rotacja → `qwen3:4b-instruct-2507-q4_K_M` | `362.3 s` · 10 iter. · 3 cykle | **FAIL** (`cliExitCode: 1`, testy nietknięte) | **`BLOCKED`** *(NIE PASS)* | Wyczerpano limit cykli samonaprawy (`no-files-modified` / niespełnione `change-check`). SWE-agent Edit-Lint-Revert cofnął błąd składni, `change-check` zablokował fałszywy sukces, zapisano 3 nieudane próby. |
| **4** | **`pricing`** (`src/pricing.mjs`, `calculateOrderTotal`, 3 testy) | `task-5332.log` | **CLI:** `node forge/cli.mjs autopilot` | Dev: `qwen3:4b-instruct-2507-q4_K_M`<br>Rev: `qwen2.5-coder:3b` | `292.2 s` · 2 iter. (`3464 in / 259 out`) | **PASS (3/3)** · testy nietknięte | **`PASS`** | Chirurgiczna naprawa 1 linii (`1 + d/100 → 1 - d/100`), 3/3 `node --test`, `independentModelReviewed: true`, `secretScanClean: true`. |
| **5** | **`order-pipeline`** (`src/discount.mjs` + `src/order.mjs`, 2 pliki) | `task-5345.log` | `executeAutopilotMission` + auto `git worktree` | Dev: `qwen3:4b-instruct-2507-q4_K_M`<br>Rev: `qwen2.5-coder:3b` | `322.6 s` · 3 iter. (`5707 in / 363 out`) | **PASS (3/3)** · testy nietknięte | **`PASS`** | 2-plikowa naprawa w 1 równoległej turze w `git worktree`, czyste scalenie, 3/3 `node --test`, `independentModelReviewed: true`, `secretScanClean: true`. |
| **6** | **`pl-slugify`** (`src/slug.mjs`, polskie `ł/Ł` w Unicode NFD) | `task-5350.log` | `executeAutopilotMission` + auto `git worktree` | `qwen3:4b-instruct-2507-q4_K_M` → rotacja → `qwen2.5-coder:3b` | `420.1 s` · 6 iter. · 1 cykl | **FAIL** (testy i repo nietknięte) | **`PAUSED`** *(NIE PASS)* | Model 4B naprawił testy 1 i 3, ale poległ na transliteracji `ł/Ł` (test 2); detektor pętli (`repeatedTestFailCount >= 2`) wykonał Strategy Pivot i rotację na `3B` → limit czasu `420 s`. |

**Bilans uczciwy Live AI na 2 vCPU CPU-only (modele 3B–4B, `$0.00`):**
- **6 nazwanych testów Live AI:** **`2 PASS`** (`pricing`, `order-pipeline`) · **`3 PAUSED`** (`invoice-engine`, `inventory`, `pl-slugify`) · **`1 BLOCKED`** (`discount`) · **`0` fałszywych `PASS`** · **`0` uszkodzeń repozytorium ani testów**.
- **Łącznie z krokiem 7 `npm run forge:accept`:** **`3 PASS` · `3 PAUSED` · `1 BLOCKED`**.

---

## C. Realne możliwości (wyłącznie potwierdzone dowodami)

1. **Autonomiczne naprawy 1–2-plikowe w trybie zero-config (`$0.00`):** potwierdzone na prawdziwych lokalnych modelach Ollama (`qwen3:4b-instruct-2507-q4_K_M` + `qwen2.5-coder:3b`) przez CLI (`forge/cli.mjs autopilot`), API (`executeAutopilotMission`) i `forge:accept` — od naturalnego polecenia w języku polskim po edycję, realny `node --test`, niezależną recenzję i zapis statystyk do `ExperienceMemory`.
2. **Spójny przepływ codzienny Core ↔ Autopilot ↔ UI:**
   - W Jarvis Core zapytanie *„Przeanalizuj moduł faktur, znajdź błędy i popraw je. Nie zmieniaj testów. Na koniec uruchom testy i pokaż mi wynik”* trafia do grupy `coding` w `src/lib/toolSelector.ts` (udostępniając `autopilot_run`, `autopilot_status`, `autopilot_decide`, `autopilot_rollback`).
   - W `forge/engine.mjs` po poprawce `ce42434` to polecenie nie jest mylnie traktowane jako `read-only` (wymusza realną zmianę kodu i uruchamianie testów), jednocześnie automatycznie chroniąc istniejące testy (`protectExistingTests: true`).
   - W `src/components/ForgeWorkspace.tsx` (zweryfikowane na żywo w Google Chrome) użytkownik widzi aktywne zadanie, aktualną fazę, realny model (`provider/model`), postęp %, zmodyfikowane pliki z diffem, wyniki testów, bloker/kartę decyzji (`waiting_approval`), przyciski `Pauza` / `Przerwij` / `Wznów z checkpointu` (z żywą aktualizacją SSE) i `Cofnij zmiany`.
3. **Prawdziwa niezależna recenzja cross-model (`independentModelReviewed`):** rozróżnia faktyczny przegląd innym modelem od weryfikacji pomocniczej tym samym modelem i jawnie pokazuje ten status w UI.
4. **Bezstratny cykl pracy z izolacją `git worktree`:** zadania `medium`/`hard` na czystym repo automatycznie pracują w izolowanym `git worktree`; pauza i timeout zachowują worktree do wznowienia; główne repozytorium pozostaje nietknięte w razie `PAUSED`/`BLOCKED`.
5. **Odporność na błędy małych modeli i awarie dostawców:** normalizacja aliasów narzędzi, tolerancja uszkodzonego JSON (`\'`, surowe `\n`, trailing commas), odrzucanie no-op edycji, SWE-agent Edit-Lint-Revert, detektor pętli + rotacja modelu, przejściowy cooldown `5xx`/sieci oraz bezpieczny fallback Architecta.

---

## D. Ograniczenia (uczciwa lista bez ukrywania)

1. **Jakość lokalnych modeli 3B–4B na zadaniach wielobłędowych i niuansach językowych:** na 2 vCPU modele `3B–4B` zawodzą przy 3 jednoczesnych błędach w pliku (`invoice-engine`, `inventory`, `discount`) lub transliteracji `ł/Ł` w NFD (`pl-slugify`). System zachowuje się wtedy bezpiecznie (`PAUSED`/`BLOCKED`, brak uszkodzeń), ale do złożonych zadań wymaga silniejszego modelu: lokalnego GPU `7B–32B` albo darmowego klucza API Kat. B (`Gemini`, `Cerebras`, `Groq`, `Mistral`, `OpenRouter :free`, itp.).
2. **Opóźnienia CPU-only (2 vCPU bez GPU):** pojedynczy 2-plikowy przebieg na `qwen3:4b-instruct` trwał `322.6 s` (~5.4 min). Na fizycznym komputerze z GPU lub przez darmowe API ten sam przebieg schodzi do kilkunastu sekund.
3. **Brak darmowych kluczy API Kat. B w VM:** żaden z 10 darmowych dostawców chmurowych nie jest skonfigurowany w zmiennych środowiskowych VM, więc żywa eskalacja `local_free → api_free` na zewnętrznym darmowym API ma status **`NOT RUN`** w VM (zweryfikowana deterministycznie w Vitest).
4. **Brak fizycznego sprzętu Ubuntu i brak binarki Electron w VM:** natywne okno Electron, realny IPC `jarvis:forge-ensure-local`, `safeStorage`, `desktopCapturer`, skrót `Ctrl+Alt+X`, akceleracja GPU oraz paczki `AppImage`/`DEB` (punkt `K5` w `docs/JARVIS_REPAIR_PLAN.md`) nie mogą zostać przetestowane w headless KVM VM — wymagają manualnego odbioru na docelowej maszynie Ubuntu.
5. **Android APK (`apk=STALE`):** ostatni build APK pochodzi z `2afee4f` i nie był przebudowywany w Fazie 5.
6. **Drobny defekt kosmetyczny generatora `project-memory` (poza zakresem Fazy 5):** `scripts/lib/project-memory.mjs` używa `.trim()` na `git status --porcelain=v1`, co przy brudnym drzewie obcina wiodącą spację 1. wiersza (`"roject-memory/..."`); nie wpływa to na czyste drzewo robocze ani na integralność raportów `PASS`.

---

## E. Odbiór fizycznego Ubuntu

### E.1 Rzeczywiste rozróżnienie: zdalna VM vs fizyczny Ubuntu użytkownika

| Parametr | Ta maszyna (zweryfikowana faktami) | Fizyczny komputer Ubuntu użytkownika |
|---|---|---|
| Host / wirtualizacja | `devbox` · **KVM (`Cloud Hypervisor`)**, Chassis `vm` | Fizyczny sprzęt (lub docelowa stacja robocza użytkownika) |
| System / kernel | Ubuntu 24.04.5 LTS · Linux `6.18.57 #1-NixOS` | Rzeczywisty kernel i sesja użytkownika (X11/Wayland) |
| CPU / RAM / dysk | 2 vCPU Intel Xeon @ 2.30 GHz · 7.8 GB RAM · 77 GB wolne | Rzeczywiste rdzenie, RAM i dysk użytkownika |
| GPU / VRAM | **BRAK (`NO_GPU`)** | Ewentualne NVIDIA/AMD/Intel GPU (do sprawdzenia na miejscu) |
| Binarka Electron | **BRAK (`node_modules/electron/dist/electron` nie istnieje)** | Zainstalowana przez `npm install` / `npm run ubuntu:setup` |
| Integracja IPC Electron | Zweryfikowana statycznie i w testach (`electron/local-forge.cjs`, `electron/main.cjs:465-468`, `electron/preload.cjs:24`) — **NOT RUN natywnie w oknie Electron** | Wymaga żywego uruchomienia `npm run electron:dev` |
| Zdalny dostęp z VM | Brak bezpośredniego połączenia z komputerem użytkownika | Odbiór wykonywany bezpośrednio przez właściciela wg procedury poniżej |

### E.2 Dokładna procedura odbioru na fizycznym Ubuntu (krok po kroku)

Wykonaj poniższe kroki bezpośrednio na docelowym komputerze Ubuntu na gałęzi `feat/jarvis-forge-evolution`:

#### Krok 1 — Diagnostyka sprzętu i środowiska Ubuntu (bez modyfikacji systemu)
```bash
hostnamectl && systemd-detect-virt || true
lscpu | head -n 15 && free -h && df -h .
command -v nvidia-smi && nvidia-smi || echo "Brak NVIDIA GPU"
npm run ubuntu:check
```
- **Oczekiwany wynik:** `systemd-detect-virt` zwraca `none` (sprzęt fizyczny), natywny Node.js 22 LTS i Git są obecne, brak mieszania z binarami WSL/Windows.

#### Krok 2 — Instalacja zależności (w tym binarki Electron) i budowa UI
```bash
npm install
ls -lh node_modules/electron/dist/electron
npm run build
```
- **Oczekiwany wynik:** binarka `node_modules/electron/dist/electron` istnieje, `npm run build` kończy się kodem `0`.

#### Krok 3 — Uruchomienie lokalnej Ollamy i dobór modelu pod realny sprzęt
```bash
# Jeśli Ollama nie jest jeszcze zainstalowana:
# curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
# Na CPU lub GPU 4–6 GB VRAM:
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama pull qwen2.5-coder:3b
# Jeśli masz GPU >= 8–12 GB VRAM (zalecane — znacznie wyższa skuteczność):
# ollama pull qwen2.5-coder:7b    # lub qwen2.5-coder:14b przy >= 12 GB VRAM
ollama list
```

#### Krok 4 — Automatyczny skrypt odbioru Ubuntu (wszystkie 7 kroków w jednym poleceniu)
```bash
npm run forge:accept
```
- **Kryterium zaliczenia na fizycznym Ubuntu:** **`7 PASS · 0 WARN · 0 FAIL`** (wszystkie 7 kroków zielone, w tym `3_electron_integration: PASS`, `4_local_ollama: PASS` oraz `7_live_coding_task_local_ollama: PASS`).

#### Krok 5 — Test natywnego Electrona i IPC `jarvis:forge-ensure-local`
```bash
npm run electron:dev
```
1. Po otwarciu okna aplikacji naciśnij **`Ctrl+K`**, wpisz `forge` i otwórz **„Jarvis Forge — autonomiczne programowanie”**.
2. **Sprawdź IPC auto-start (bez ręcznego `npm run forge:server`):** w stopce panelu musi pojawić się `Autopilot gotowy · N darmowych modeli · Koszt: $0.00` (Electron sam uruchomił `forge/server.mjs` na `127.0.0.1:3220` i zapisał token w `~/.config/jarvis-ai-assistant/jarvis-forge/runtime/connection.json`).
3. W zakładce **„🧠 Modele i pamięć”** zweryfikuj, że wykryty sprzęt (CPU/RAM/GPU) zgadza się z fizycznym komputerem, a Ollama ma status `🟢`.

#### Krok 6 — Żywe zadanie codzienne + Pauza / Wznowienie / Rollback w UI
1. Utwórz bezpieczne repo testowe w `/tmp/jarvis-ubuntu-live` z 1 plikiem kodu (celowy błąd znaku) i 1 plikiem `node --test`.
2. W panelu **Jarvis Autopilot** rozwiń `⚙ Opcje`, wpisz ścieżkę `/tmp/jarvis-ubuntu-live` i wklej polecenie:
   > *Przeanalizuj moduł faktur, znajdź błędy i popraw je. Nie zmieniaj testów. Na koniec uruchom testy i pokaż mi wynik*
3. Kliknij **`▶ Uruchom Autopilot`**:
   - potwierdź widoczność aktywnego zadania, modelu (`ollama/...`), postępu % oraz przycisków `⏸ Pauza (checkpoint)` i `⏹ Przerwij`;
   - przetestuj **`⏸ Pauza (checkpoint)`** → stan zmienia się na `PAUSED` bez fałszywego sukcesu → kliknij **`▶ Wznów z checkpointu`** → UI automatycznie aktualizuje się przez SSE aż do `Zakończono sukcesem (PASS)`, pokazuje diff i wynik testu `1/1 PASS`, a plik testowy jest nietknięty;
   - opcjonalnie przetestuj **`↩ Cofnij zmiany`** oraz uruchomienie polecenia z `git push origin main` (musi pojawić się pomarańczowa karta `⚠ WYMAGANA DECYZJA UŻYTKOWNIKA` bez wykonania operacji).

#### Krok 7 — Szybka diagnostyka typowych problemów na Ubuntu
| Objaw | Przyczyna i rozwiązanie |
|---|---|
| `3_electron_integration: WARN` (brak binarki Electron) | Uruchom `npm install` (bez `--ignore-scripts`) lub `npm run ubuntu:setup`. |
| `sandbox` / błąd uruchamiania Electrona na Ubuntu 24.04 | Sprawdź uprawnienia user namespaces lub uruchom diagnostycznie `npx electron --no-sandbox .` (w docelowej paczce DEB/AppImage obsłużone przez profil AppArmor). |
| `Lokalny silnik Jarvis Forge nie jest uruchomiony` | Sprawdź czy port `127.0.0.1:3220` nie jest zajęty (`ss -tlnp \| grep 3220`) oraz log ręcznego startu `npm run forge:server`. |
| `4_local_ollama: WARN` | Upewnij się, że `ollama serve` działa (`curl -s http://127.0.0.1:11434/api/tags`) i ma pobrany model `qwen3:4b-instruct-2507-q4_K_M` lub `qwen2.5-coder:7b`. |
| `status: blocked` (`no_free_provider`) | Brak działającej Ollamy i brak klucza API Kat. B — uruchom Ollamę albo ustaw darmowy klucz (np. `GEMINI_API_KEY` / `GROQ_API_KEY`). Jarvis **celowo** nie przełącza się po cichu na płatne API. |

---

## F. Bezpieczeństwo i koszty

### F.1 Weryfikacja 11 mechanizmów bezpieczeństwa i dyscypliny kosztowej

| # | Mechanizm kontrolny | Dowód w kodzie | Dowód w testach / uruchomieniach | Status |
|---|---|---|---|---|
| 1 | **Blokada budżetu (agent nie podnosi limitu)** | `forge/autopilot.mjs:138-155` (`enforceBudgetPolicyGuard`, `BUDGET_ESCALATION_DENIED`), `forge/engine.mjs:373,405` (`budgetLocked: true`), `forge/server.mjs:320,484,546` | `tests/jarvisPhase4Autopilot.test.ts` #4 (HTTP 403 `BUDGET_ESCALATION_DENIED`) | **`PASS`** |
| 2 | **Brak cichego fallbacku na płatne API** | Domyślna polityka `zero_cost`, `PAID_APPROVAL_REQUIRED` w `forge/autopilot.mjs:157-163`, filtracja kluczy `anthropic`/`modal` w `src/lib/forgeClient.ts:276-302` | `tests/jarvisPhase4Autopilot.test.ts` #3, #4, Sc. 5 (`no_free_provider` → `BLOCKED`, `0 USD`) | **`PASS`** |
| 3 | **Ochrona istniejących testów i blokada osłabiania asercji** | `forge/workspace.mjs:715` (`detectTestWeakening`), `:986-1098` (`protectExistingTests`, `test-tampering-blocked`, `test-weakening-blocked`), `forge/engine.mjs:502-517` | `tests/jarvisPhase5Resilience.test.ts` #2, #8, #9 + wszystkie 7 biegów Live AI (`testFileUntouched: true`) | **`PASS`** |
| 4 | **Odrzucanie pustych zmian (`no-op` / fałszywy sukces)** | `forge/workspace.mjs:1005` (`noOp: true`), `forge/engine.mjs:1289-1307` (`change-check` + `completeness-gate`, naprawione także dla złożonych poleceń „Przeanalizuj... i popraw”) | `tests/jarvisPhase5Resilience.test.ts` #6, #9 + Live AI `task-5282`, `task-5311` | **`PASS`** |
| 5 | **Detektor pętli i automatyczna rotacja / pivot** | `forge/engine.mjs:1218-1269` (`consecutiveNoOps >= 2`, `consecutiveFailedEdits >= 3`, `repeatedTestFailCount >= 2`, `consecutiveFailedTestRuns >= 3`) + `:1473,1520` | `tests/jarvisPhase5Resilience.test.ts` #6 + Live AI `task-5273`, `task-5282`, `task-5350` | **`PASS`** |
| 6 | **Uniwersalny limit czasu zegarowego (`maxDurationMs`)** | `forge/engine.mjs:466-483,543-561` (`TIME_LIMIT_EXCEEDED` → `status: "paused"`, `pauseReason: "time_limit"`), `forge/budget.mjs:297` | `tests/jarvisPhase4Autopilot.test.ts` Sc. 5 + Live AI `task-5273`, `task-5282`, `task-5350` | **`PASS`** |
| 7 | **Trwałe checkpointy i bezstratne wznowienie (również w `worktree`)** | `forge/engine.mjs:270-290,487-500,1872`, `forge/autopilot.mjs:789-831` | `tests/jarvisPhase5Resilience.test.ts` #4, #9 + `tests/jarvisPhase4Autopilot.test.ts` Sc. 4 + `forge:accept` krok 5 + Live Chrome UI | **`PASS`** |
| 8 | **Deterministyczny rollback z migawek sprzed edycji** | `forge/engine.mjs:2269` (`rollbackForgeRun`), `forge/server.mjs:623-629`, `forge/cli.mjs:277` | `tests/jarvisForgeEvolution.test.ts` #3, #7 + `tests/jarvisPhase4Autopilot.test.ts` Sc. 4 + `tests/jarvisPhase5Resilience.test.ts` #4 + `forge:accept` krok 5 | **`PASS`** |
| 9 | **Zakaz samo-zatwierdzania i bramka operacji destrukcyjnych** | `forge/autopilot.mjs:95-131` (`assessMissionSafety`), `:691-695` (`SELF_APPROVAL_DENIED`), `forge/server.mjs:433-436`, `src/lib/permissions.ts` (`ALWAYS_CONFIRM` dla `autopilot_decide`/`autopilot_rollback`) | `tests/jarvisPhase4Autopilot.test.ts` #3, #4 + Live Chrome UI (karta `waiting_approval` dla `git push origin main`) | **`PASS`** |
| 10 | **Redakcja sekretów w logach, checkpointach, pamięci, SSE i zapisie plików** | `forge/security.mjs:11-91` (`redactSecrets`, `redactDeep`, `scanSecretsInText`) podpięte w `forge/server.mjs:105,130`, `forge/engine.mjs:276`, `forge/memory.mjs:120`, `forge/workspace.mjs:362,425,920,1016,1070` | `tests/jarvisForgeEvolution.test.ts` #3 + `node scripts/secret-scan.mjs --all` (`exit 0`) | **`PASS`** |
| 11 | **Izolacja współbieżna (`git worktree` + HTTP 409 lock + pętla loopback)** | `forge/worktree.mjs`, `forge/engine.mjs:1882-1950`, `forge/server.mjs:329-338,473-482,648-651` (HTTP 409 lock + loopback `127.0.0.1` + `X-Forge-Client` + blokada `Origin:null`) | `tests/jarvisForgePhase2Hardening.test.ts` #5, #6 + `forge:accept` krok 2 | **`PASS`** |

### F.2 Rzeczywiste koszty (zweryfikowane przez `node forge/cli.mjs budget`)
- **Koszt gotówkowy (out-of-pocket):** **`$0.00`**
- **Płatne wywołania API (Anthropic / płatny OpenAI / OpenRouter bez `:free`):** **`0` (`$0.00`)**
- **Modal Serverless GPU (`ajozefczak59`, raport read-only z `node forge/cli.mjs budget`):**
  - `billedCostUsd`: **`$0.00`** (`hasPaidBilling: false`)
  - `ephemeralAppsUsd`: **`$1.45`** *(bez zmian względem Fazy 4 — `0` nowych kontenerów uruchomionych w Fazie 5 i podczas odbioru)*
  - `creditsAppliedUsd`: `$29.03` · `deployedAppsUsd`: `$27.59` · `meteredCostUsd`: `$74.07`
  - **Zastrzeżenie bezpieczeństwa:** `remainingCreditsKnown: false`, `delayedBillingRisk: true` — Modal nie uruchamia się w polityce `zero_cost` i pozostaje wyłączony do czasu jawnej zgody i twardego limitu właściciela.

---

## G. Instrukcja uruchomienia (codzienna praca)

### 1. Tryb desktopowy Electron (docelowy na fizycznym Ubuntu)
```bash
npm install
npm run build
# Upewnij się, że Ollama działa w tle (lub masz darmowy klucz API Kat. B w ustawieniach Jarvisa):
ollama serve &
npm run electron:dev
```
W aplikacji otwórz **`Ctrl+K` → `Jarvis Forge — autonomiczne programowanie`** (albo wpisz zadanie w czacie Jarvisa — narzędzie `autopilot_run` jest podpięte w Jarvis Core).

### 2. Tryb przeglądarkowy + lokalny serwer Forge
```bash
# Terminal 1 — lokalny silnik Forge (loopback 127.0.0.1:3220, domyślnie zero_cost = $0.00):
npm run forge:server

# Terminal 2 — interfejs Jarvisa:
npm run dev
```

### 3. Tryb CLI (bez uruchamiania UI)
```bash
# Sprawdzenie sprzętu, gotowych darmowych dostawców i polityki kosztów:
npm run forge:status
npm run forge:budget

# Autonomiczne wykonanie zadania w wybranym repozytorium:
node forge/cli.mjs autopilot "Przeanalizuj moduł faktur, znajdź błędy i popraw je. Nie zmieniaj testów. Na koniec uruchom testy i pokaż mi wynik" --repo /sciezka/do/repo
```

### 4. Opcjonalne dołączenie darmowego API kategorii B (`$0.00` — zalecane do złożonych zadań wieloplikowych)
```bash
export GEMINI_API_KEY="..."      # lub CEREBRAS_API_KEY / GROQ_API_KEY / MISTRAL_API_KEY / OPENROUTER_API_KEY
node forge/cli.mjs providers
```

---

## H. Rekomendacja

### Werdykt końcowy: **`READY AFTER MANUAL UBUNTU ACCEPTANCE`**

**Uzasadnienie oparte wyłącznie na faktach:**
1. **Wszystkie zautomatyzowane bramki jakości, bezpieczeństwa, kosztów i integracji UI przechodzą w 100%** (w tym 2 realne usterki UX/poprawności wykryte i naprawione w trakcie samego odbioru końcowego w commicie `ce42434`, zabezpieczone nowym testem regresyjnym #9 i potwierdzone na żywo w Google Chrome).
2. **Realna autonomia na lokalnych modelach AI (`$0.00`) jest udowodniona** w 3 niezależnych przebiegach `PASS` z prawdziwym `node --test` i niezależną recenzją cross-model, a w 4 trudniejszych przebiegach (`PAUSED`/`BLOCKED`) system zachował pełne bezpieczeństwo repozytorium bez fałszywego sukcesu.
3. **Jedyny brakujący warunek przed scaleniem `feat/jarvis-forge-evolution` do `main` (który nie może być uczciwie zasymulowany w zdalnej KVM VM)** to jednorazowy odbiór manualny na fizycznym komputerze Ubuntu z sekcji **E.2**: `npm install` (instalacja binarki Electron) → `npm run forge:accept` (`7 PASS, 0 WARN, 0 FAIL`) → natywny start `npm run electron:dev` z IPC `jarvis:forge-ensure-local` oraz 1 żywy test codziennego zadania z pauzą i wznowieniem.

Po pozytywnym przejściu procedury z sekcji **E.2** na fizycznym Ubuntu (oraz ewentualnej recenzji ADR-0009 przez właściciela) gałąź `feat/jarvis-forge-evolution` będzie gotowa do kontrolowanego scalenia z `main`.
