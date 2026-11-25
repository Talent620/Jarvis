<!-- GENERATED: scripts/sync-project-state.mjs · sha256:15a8e4e3b7e07554931b9fbffd78180fe64c25d0fe63ba5a34acf1078ac0e7e3 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-25T20:34:44.895Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `7c00e53` na `feat/jarvis-forge-evolution` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 5.0.0-production-rc (14 modułów, 132 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 7c00e53 | 0 | 2026-11-25T20:26:34.134Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 7c00e53 | 0 | 2026-11-25T20:27:00.198Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | 7c00e53 | 0 | 2026-11-25T20:32:11.354Z | kod wyjścia 0 dla bieżącego stanu · Test Files  374 passed (374) · Tests  3139 passed (3139) |
| build | **PASS** | 7c00e53 | 0 | 2026-11-25T20:32:54.990Z | kod wyjścia 0 dla bieżącego stanu · built in 15.49s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 374 · `src/lib` 317 · `src/components` 80 · `android` 64 · `docs` 35 · `project-memory` 32 · `(root)` 20 · `electron` 17 · `scripts` 17 · `ios` 15 · `proxy` 13 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `7c00e53` feat(forge): Phase 2 live-test fixes (Edit-Lint-Revert, completeness gate, Ollama inline tools, worktree porce
- `90509cf` feat(forge): Phase 2 security policy, 3-category promo budget governor, Modal bridge, worktree isolation, impa
- `eeb8cb2` docs(memory): record jarvis-forge-evolution event, ADR-0009 & verified CURRENT_STATE
- `e3a79f4` test(forge): full vertical-slice E2E, HTTP 429 Retry-After failover, ACI safety, strategy pivot, pause/resume 
- `72b9c9c` feat(ui): Jarvis Forge minimalist autonomous workspace (<Modal>, live SSE, 10-point status, diffs, rollback, m

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

## Dziennik agentów (13/13 poprawnych)
- 2026-11-25T20:34:44.592Z · antigravity · `jarvis-forge-phase2` → Uruchomić npm run forge:accept na fizycznym Ubuntu (Ollama 7B-14B lub darmowy klucz API), naprawić O
- 2026-11-25T18:48:22.050Z · antigravity · `jarvis-forge-evolution` → Przegląd właściciela, test z rzeczywistym darmowym kluczem API lub lokalną Ollamą na fizycznym Ubunt
- 2026-11-25T10:07:11.988Z · antigravity · `production-release-main` → Odbiór sprzętowy właściciela na fizycznym Ubuntu i telefonie Android, a następnie git push origin ma
- 2026-11-25T09:41:27.545Z · antigravity · `production-hardening` → Odbiór sprzętowy właściciela na fizycznym Ubuntu (binarka Electron + Site OS 2.0 + lokalna Ollama) i
- 2026-11-25T06:41:22.297Z · antigravity · `master-interface-polish` → Odbiór wizualny i sprzętowy właściciela na fizycznym Ubuntu oraz przetestowanie warsztatu Site OS 2.
- **Następny krok (ostatnie zdarzenie):** Uruchomić npm run forge:accept na fizycznym Ubuntu (Ollama 7B-14B lub darmowy klucz API), naprawić OOM L4 w deploy/modal_brain.py i zdecydować o scaleniu feat/j

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed), ADR-0005-omni-frontier (proposed), ADR-0006-ux-obsidian-precision (proposed), ADR-0008-master-interface-and-siteos2 (proposed), ADR-0009-jarvis-forge-evolution (proposed) · nieudane podejścia: 7

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
