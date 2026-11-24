<!-- GENERATED: scripts/sync-project-state.mjs · sha256:d230b3d8b860db886ce61021a08ab3d819f1cb10fc3b5ef74f057274b0c3bd97 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-24T19:58:10.567Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `962d0f0` na `feat/apex-polish` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 4.0.0-apex (10 modułów, 119 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 962d0f0 | 0 | 2026-11-24T19:52:25.196Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 962d0f0 | 0 | 2026-11-24T19:52:45.312Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | 962d0f0 | 0 | 2026-11-24T19:57:11.282Z | kod wyjścia 0 dla bieżącego stanu · Test Files  362 passed (362) · Tests  3041 passed (3041) |
| build | **PASS** | 962d0f0 | 0 | 2026-11-24T19:57:49.631Z | kod wyjścia 0 dla bieżącego stanu · built in 13.82s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 362 · `src/lib` 311 · `src/components` 78 · `android` 64 · `docs` 30 · `(root)` 20 · `project-memory` 18 · `ios` 15 · `scripts` 15 · `electron` 13 · `proxy` 13 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `962d0f0` fix(memory): parse markdown-bold ADR Status lines, update W1 diagnostics status & record ADR-0003
- `140ec2e` feat(ui): XSS-safe Markdown & code blocks with Copy, Composer image paste/drop & history, executive AutoCorePa
- `a9e3890` feat(android): NativeTTS utterance completion & USAGE_ASSISTANT, WakeWord error backoff, hardware Back LIFO + 
- `bd708d2` feat(linux): native power/volume/media, real GPU/VRAM & W1 diagnostics, OS keyring safeStorage, system tray & 
- `da4ee14` chore(memory): main verified snapshot with apk=PASS (v5-jarvis-autocore)

## Otwarte sprawy z istniejącej dokumentacji (27)
- K4. Dodać bootstrap Ubuntu — `docs/JARVIS_REPAIR_PLAN.md:43`
- K5. Zbudować i sprawdzić paczki Linux — `docs/JARVIS_REPAIR_PLAN.md:56`
- W2. Intuicyjny kreator integracji — `docs/JARVIS_REPAIR_PLAN.md:79`
- W4. MCP stdio na Ubuntu — fundament wykonany — `docs/JARVIS_REPAIR_PLAN.md:93`
- O1. Podział testów — `docs/JARVIS_REPAIR_PLAN.md:115`
- O2. Rozmiar aplikacji — `docs/JARVIS_REPAIR_PLAN.md:122`
- O3. Lekki profil lokalny — `docs/JARVIS_REPAIR_PLAN.md:129`
- O4. Powtarzalne obrazy i wydania — `docs/JARVIS_REPAIR_PLAN.md:136`
- R1. Trwały agent wykonawczy — `docs/JARVIS_REPAIR_PLAN.md:145`
- R2. Bezpieczne narzędzia generowane — `docs/JARVIS_REPAIR_PLAN.md:160`
- R3. Pamięć decyzji — `docs/JARVIS_REPAIR_PLAN.md:172`
- R4. Centrum autonomii — `docs/JARVIS_REPAIR_PLAN.md:181`
- R1: Zgłoszony przez użytkownika błąd 500 (Google/Gemini + druga funkcja równolegle) — `docs/horizon-memory.md:175`
- R2: Cel S9/Chrome 79 (es2019, bez `\p{L}`, bez lookbehind) i pułapka cudzysłowów — `docs/horizon-memory.md:177`
- … +13 w CURRENT_STATE.json

## Dziennik agentów (4/4 poprawnych)
- 2026-11-24T19:58:10.291Z · antigravity · `apex-polish` → Recenzja i merge PR feat/apex-polish -> main, a nastepnie build Linux (.AppImage/.deb) i nowego APK 
- 2026-11-24T16:34:28.808Z · antigravity · `autocore-finish` → Weryfikacja APK v5-jarvis-autocore i odswiezenie memory:check --apk
- 2026-11-24T15:46:22.424Z · antigravity · `autocore` → Przeglad PR feat/autocore, ustawienie limitu budzetu w UI, opcjonalne uruchomienie scripts/install-g
- 2026-11-24T14:42:48.650Z · antigravity · `guardian-5a` → Recenzja feat/guardian-5a przez innego agenta lub właściciela (autor != jedyny recenzent), następnie
- **Następny krok (ostatnie zdarzenie):** Recenzja i merge PR feat/apex-polish -> main, a nastepnie build Linux (.AppImage/.deb) i nowego APK v6-jarvis-apex

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
