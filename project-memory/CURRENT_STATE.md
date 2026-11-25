<!-- GENERATED: scripts/sync-project-state.mjs · sha256:59dc97ed12fbcd878b970b7c768e7a9700ef81a3c0abd6e6d86e6afd782e590b · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-25T18:48:22.347Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `e3a79f4` na `feat/jarvis-forge-evolution` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 5.0.0-production-rc (14 modułów, 132 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | e3a79f4 | 0 | 2026-11-25T18:41:21.775Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | e3a79f4 | 0 | 2026-11-25T18:41:46.768Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | e3a79f4 | 0 | 2026-11-25T18:46:54.024Z | kod wyjścia 0 dla bieżącego stanu · Test Files  373 passed (373) · Tests  3133 passed (3133) |
| build | **PASS** | e3a79f4 | 0 | 2026-11-25T18:47:37.739Z | kod wyjścia 0 dla bieżącego stanu · built in 16.37s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 373 · `src/lib` 317 · `src/components` 80 · `android` 64 · `docs` 34 · `project-memory` 31 · `(root)` 20 · `electron` 17 · `scripts` 16 · `ios` 15 · `proxy` 13 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `e3a79f4` test(forge): full vertical-slice E2E, HTTP 429 Retry-After failover, ACI safety, strategy pivot, pause/resume 
- `72b9c9c` feat(ui): Jarvis Forge minimalist autonomous workspace (<Modal>, live SSE, 10-point status, diffs, rollback, m
- `d3b528b` feat(forge): autonomous coding engine (repo-intel, ACI workspace, 14-provider free-first mesh, experience memo
- `dd78a3f` feat(forge): ADR-0009 architecture audit & core autonomy fixes (system_* RISK, :free guard, Retry-After, BLOCK
- `8bc8e03` docs(memory): record production-release-main event & verified CURRENT_STATE on main

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

## Dziennik agentów (12/12 poprawnych)
- 2026-11-25T18:48:22.050Z · antigravity · `jarvis-forge-evolution` → Przegląd właściciela, test z rzeczywistym darmowym kluczem API lub lokalną Ollamą na fizycznym Ubunt
- 2026-11-25T10:07:11.988Z · antigravity · `production-release-main` → Odbiór sprzętowy właściciela na fizycznym Ubuntu i telefonie Android, a następnie git push origin ma
- 2026-11-25T09:41:27.545Z · antigravity · `production-hardening` → Odbiór sprzętowy właściciela na fizycznym Ubuntu (binarka Electron + Site OS 2.0 + lokalna Ollama) i
- 2026-11-25T06:41:22.297Z · antigravity · `master-interface-polish` → Odbiór wizualny i sprzętowy właściciela na fizycznym Ubuntu oraz przetestowanie warsztatu Site OS 2.
- 2026-11-24T23:20:07.805Z · antigravity · `production-integration` → Wykonać 10-15 min checklistę odbiorczą na fizycznym Linuxie (Ollama + binarny Electron + X11/Wayland
- **Następny krok (ostatnie zdarzenie):** Przegląd właściciela, test z rzeczywistym darmowym kluczem API lub lokalną Ollamą na fizycznym Ubuntu i decyzja o scaleniu feat/jarvis-forge-evolution.

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed), ADR-0005-omni-frontier (proposed), ADR-0006-ux-obsidian-precision (proposed), ADR-0008-master-interface-and-siteos2 (proposed), ADR-0009-jarvis-forge-evolution (proposed) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
