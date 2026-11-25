<!-- GENERATED: scripts/sync-project-state.mjs · sha256:41b3b7578969d3249b1a09a05bbdf47ae41f44cb9d5c6c350b572f8cced6edfb · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-25T03:28:32.312Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `9cbed36` na `exp/symbiont-ghost-ar` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 5.0.0-production-rc (14 modułów, 133 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 9cbed36 | 0 | 2026-11-25T03:21:29.905Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 9cbed36 | 0 | 2026-11-25T03:21:51.868Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | 9cbed36 | 0 | 2026-11-25T03:26:15.776Z | kod wyjścia 0 dla bieżącego stanu · Test Files  370 passed (370) · Tests  3124 passed (3124) |
| build | **PASS** | 9cbed36 | 0 | 2026-11-25T03:26:55.132Z | kod wyjścia 0 dla bieżącego stanu · built in 14.21s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 370 · `src/lib` 317 · `src/components` 79 · `android` 64 · `docs` 30 · `project-memory` 27 · `(root)` 20 · `electron` 20 · `scripts` 16 · `ios` 15 · `proxy` 13 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `9cbed36` feat(symbiont): Phase 1 — Ghost AR desktop overlay & Foveated Perception (ADR-0007)
- `4ec1594` docs(memory): record production-integration event & verified CURRENT_STATE (369/369 suites, 3108/3108 tests, 1
- `7176268` fix(omni): refine visual stagnation contradiction threshold & clean Vite teardown in E2E probe
- `1c31896` test(e2e): Etap 4 — permanent live Xvfb+Chrome+xdotool E2E suite (npm run test:e2e:xvfb)
- `473cb7a` feat(integration): Etap 3 P0/P1/P2 — wire voiceCognition/agentPlanner/goalRuntime/verifyResult, hybrid OS-Tree

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

## Dziennik agentów (9/9 poprawnych)
- 2026-11-25T03:28:32.053Z · antigravity · `symbiont-ghost-ar` → Przeprowadzić fizyczny odbiór natywnego okna Electron GhostOverlay na Ubuntu X11/Wayland oraz Window
- 2026-11-24T23:20:07.805Z · antigravity · `production-integration` → Wykonać 10-15 min checklistę odbiorczą na fizycznym Linuxie (Ollama + binarny Electron + X11/Wayland
- 2026-11-24T21:21:57.501Z · antigravity · `ux-craft-audit` → Recenzja PR feat/ux-craft-audit przez właściciela lub innego agenta, scalenie z main oraz test docel
- 2026-11-24T20:46:19.696Z · antigravity · `omni-frontier` → Recenzja PR feat/omni-frontier (ADR-0003/0004/0005) i test na żywym pulpicie Linux/Windows; następni
- 2026-11-24T20:28:42.588Z · antigravity · `omni-pilot` → Recenzja PR feat/omni-pilot (ADR-0004) i test na żywym pulpicie Linux X11/Wayland lub Windows; po ak
- **Następny krok (ostatnie zdarzenie):** Przeprowadzić fizyczny odbiór natywnego okna Electron GhostOverlay na Ubuntu X11/Wayland oraz Windows 11 przed decyzją o scaleniu do gałęzi integracyjnej i prze

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed), ADR-0005-omni-frontier (proposed), ADR-0006-ux-obsidian-precision (proposed), ADR-0007-symbiont-ghost-ar (proposed) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
