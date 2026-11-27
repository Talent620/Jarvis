<!-- GENERATED: scripts/sync-project-state.mjs · sha256:3ddf427cce52419faa3496be4411ba16d0a4738318012c011fd7a005ea76a3f8 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-27T16:28:44.978Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `01002ba` na `feat/jarvis-forge-evolution` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 5.0.0-production-rc (14 modułów, 136 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 01002ba | 0 | 2026-11-27T16:21:37.054Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 01002ba | 0 | 2026-11-27T16:22:02.073Z | kod wyjścia 0 dla bieżącego stanu · ✖ 2 problems (0 errors, 2 warnings) |
| test | **PASS** | 01002ba | 0 | 2026-11-27T16:27:33.129Z | kod wyjścia 0 dla bieżącego stanu · Test Files  377 passed (377) · Tests  3170 passed (3170) |
| build | **PASS** | 01002ba | 0 | 2026-11-27T16:28:14.743Z | kod wyjścia 0 dla bieżącego stanu · built in 14.90s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 377 · `src/lib` 317 · `src/components` 80 · `android` 64 · `docs` 38 · `project-memory` 36 · `(root)` 20 · `electron` 17 · `scripts` 17 · `ios` 15 · `forge` 13 · `proxy` 13

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `01002ba` docs(acceptance): update closeout commit chain & final memory:check reference
- `89cc850` fix(forge): remove redundant regex escape in engine.mjs (ESLint no-useless-escape)
- `eb3a254` docs(acceptance): add final Phase 5 closeout acceptance report (docs/JARVIS_FINAL_ACCEPTANCE.md)
- `ce42434` fix(forge,ui): fix compound analyze-and-fix read-only bug, HTTP/UI resume SSE race & Scenario 4 cancel sync
- `8867109` docs(memory): record jarvis-forge-phase5-real-autonomy event & verified CURRENT_STATE (377/377, 3169/3169)

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

## Dziennik agentów (17/17 poprawnych)
- 2026-11-27T16:28:44.690Z · antigravity · `jarvis-forge-phase5-closeout-acceptance` → Wykonać manualny odbiór fizycznego Ubuntu wg sekcji E.2 docs/JARVIS_FINAL_ACCEPTANCE.md (npm install
- 2026-11-27T15:49:11.760Z · antigravity · `jarvis-forge-phase5-real-autonomy` → Niezależny przegląd feat/jarvis-forge-evolution przez właściciela; opcjonalnie dodanie darmowego klu
- 2026-11-27T12:13:57.798Z · antigravity · `jarvis-forge-phase4-autopilot` → Skonfigurować darmowy klucz Kat. B lub lokalną Ollamę na docelowym Ubuntu i uruchomić npm run forge:
- 2026-11-25T21:47:34.320Z · antigravity · `jarvis-forge-adaptive-phase3` → Na fizycznym Ubuntu przetestować Adaptive Intelligence z prawdziwym darmowym API Kat. B (np. Gemini/
- 2026-11-25T20:34:44.592Z · antigravity · `jarvis-forge-phase2` → Uruchomić npm run forge:accept na fizycznym Ubuntu (Ollama 7B-14B lub darmowy klucz API), naprawić O
- **Następny krok (ostatnie zdarzenie):** Wykonać manualny odbiór fizycznego Ubuntu wg sekcji E.2 docs/JARVIS_FINAL_ACCEPTANCE.md (npm install + Electron, npm run forge:accept 7/7, npm run electron:dev 

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed), ADR-0005-omni-frontier (proposed), ADR-0006-ux-obsidian-precision (proposed), ADR-0008-master-interface-and-siteos2 (proposed), ADR-0009-jarvis-forge-evolution (proposed) · nieudane podejścia: 9

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
