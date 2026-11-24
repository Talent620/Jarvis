<!-- GENERATED: scripts/sync-project-state.mjs · sha256:c8553f43fa1a3c00b2f0f200fd4bc7aeed700359b06c012a2e911f520369e00b · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-24T14:42:59.954Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `07911a1` na `feat/guardian-5a` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 4.0.0-apex (10 modułów, 119 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 07911a1 | 0 | 2026-11-24T14:36:27.177Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 07911a1 | 0 | 2026-11-24T14:36:48.259Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | 07911a1 | 0 | 2026-11-24T14:41:51.009Z | kod wyjścia 0 dla bieżącego stanu · Test Files  354 passed (354) · Tests  2991 passed (2991) |
| build | **PASS** | 07911a1 | 0 | 2026-11-24T14:42:32.038Z | kod wyjścia 0 dla bieżącego stanu · built in 14.75s |
| apk | **STALE** | f5a5dc4 | — | 2026-11-24T14:42:33.411Z | APK zbudowany z f5a5dc4, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 354 · `src/lib` 302 · `src/components` 77 · `android` 64 · `docs` 30 · `(root)` 20 · `ios` 15 · `proxy` 13 · `electron` 12 · `QA` 11 · `scripts` 11 · `.github` 10

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `07911a1` feat(guardian-5a): shared agent protocol (AGENTS.md/CLAUDE.md), project memory, state generator and event jour
- `f5a5dc4` fix(android): Play-Protect-safe sideload APK (strip AccessibilityService + QUERY_ALL_PACKAGES)
- `d387067` fix(android): use fresh applicationId net.serwer256.jarvis.v4 (JARVIS Apex) to avoid signature conflict with l
- `34eda42` fix(android): sign APK with permanent GH Secrets keystore (zipalign + apksigner V1/V2/V3 verify gate), bump ve
- `ac4cbdf` fix(audit): fix ECDSA license fixture (100% Vitest pass), BFF timeouts, timer/reader/camera leaks, and configu

## Otwarte sprawy z istniejącej dokumentacji (28)
- K4. Dodać bootstrap Ubuntu — `docs/JARVIS_REPAIR_PLAN.md:43`
- K5. Zbudować i sprawdzić paczki Linux — `docs/JARVIS_REPAIR_PLAN.md:56`
- W1. Jeden diagnostyczny status zależności — `docs/JARVIS_REPAIR_PLAN.md:71`
- W2. Intuicyjny kreator integracji — `docs/JARVIS_REPAIR_PLAN.md:77`
- W4. MCP stdio na Ubuntu — fundament wykonany — `docs/JARVIS_REPAIR_PLAN.md:91`
- O1. Podział testów — `docs/JARVIS_REPAIR_PLAN.md:113`
- O2. Rozmiar aplikacji — `docs/JARVIS_REPAIR_PLAN.md:120`
- O3. Lekki profil lokalny — `docs/JARVIS_REPAIR_PLAN.md:127`
- O4. Powtarzalne obrazy i wydania — `docs/JARVIS_REPAIR_PLAN.md:134`
- R1. Trwały agent wykonawczy — `docs/JARVIS_REPAIR_PLAN.md:143`
- R2. Bezpieczne narzędzia generowane — `docs/JARVIS_REPAIR_PLAN.md:158`
- R3. Pamięć decyzji — `docs/JARVIS_REPAIR_PLAN.md:170`
- R4. Centrum autonomii — `docs/JARVIS_REPAIR_PLAN.md:179`
- R1: Zgłoszony przez użytkownika błąd 500 (Google/Gemini + druga funkcja równolegle) — `docs/horizon-memory.md:175`
- … +14 w CURRENT_STATE.json

## Dziennik agentów (1/1 poprawnych)
- 2026-11-24T14:42:48.650Z · antigravity · `guardian-5a` → Recenzja feat/guardian-5a przez innego agenta lub właściciela (autor != jedyny recenzent), następnie
- **Następny krok (ostatnie zdarzenie):** Recenzja feat/guardian-5a przez innego agenta lub właściciela (autor != jedyny recenzent), następnie Sprint 5b: monitoring bez LLM (CI/raporty) + zdalna blokada

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
