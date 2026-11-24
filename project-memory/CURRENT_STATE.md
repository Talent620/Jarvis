<!-- GENERATED: scripts/sync-project-state.mjs · sha256:193bc102bf040b5ef3af6897fc2befcc64029d1f72592b2bb9e644b9aa314f73 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-24T15:46:22.692Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `87f78dd` na `feat/autocore` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 4.0.0-apex (10 modułów, 119 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 87f78dd | 0 | 2026-11-24T15:41:09.642Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 87f78dd | 0 | 2026-11-24T15:41:30.953Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | 87f78dd | 0 | 2026-11-24T15:45:35.332Z | kod wyjścia 0 dla bieżącego stanu · Test Files  358 passed (358) · Tests  3023 passed (3023) |
| build | **PASS** | 87f78dd | 0 | 2026-11-24T15:46:11.959Z | kod wyjścia 0 dla bieżącego stanu · built in 13.25s |
| apk | **STALE** | f5a5dc4 | — | 2026-11-24T15:46:13.562Z | APK zbudowany z f5a5dc4, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 358 · `src/lib` 309 · `src/components` 78 · `android` 64 · `docs` 30 · `(root)` 20 · `ios` 15 · `scripts` 15 · `project-memory` 14 · `proxy` 13 · `electron` 12 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `87f78dd` feat(guardian): remote git-ref agent-lock, local guardian-daemon + systemd, APK verifier, AGENTS.md roles & AD
- `4916d35` feat(autocore): unified AI catalog, health, budget controller, A-J router, gateway, discovery & AutoCorePanel
- `5ecd05d` fix(proxy): allow Cerebras/Mistral hosts on /openai relay (were 403 with proxyUrl) + registry↔allowlist guard 
- `195d92b` chore(memory): first verified project state snapshot + guardian-5a event (ADR-0001 proposed)
- `07911a1` feat(guardian-5a): shared agent protocol (AGENTS.md/CLAUDE.md), project memory, state generator and event jour

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

## Dziennik agentów (2/2 poprawnych)
- 2026-11-24T15:46:22.424Z · antigravity · `autocore` → Przeglad PR feat/autocore, ustawienie limitu budzetu w UI, opcjonalne uruchomienie scripts/install-g
- 2026-11-24T14:42:48.650Z · antigravity · `guardian-5a` → Recenzja feat/guardian-5a przez innego agenta lub właściciela (autor != jedyny recenzent), następnie
- **Następny krok (ostatnie zdarzenie):** Przeglad PR feat/autocore, ustawienie limitu budzetu w UI, opcjonalne uruchomienie scripts/install-guardian.sh na docelowym Linuxie

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (UNKNOWN) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
