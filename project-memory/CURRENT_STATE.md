<!-- GENERATED: scripts/sync-project-state.mjs · sha256:101645f2cfd414d214b24f783bf231a70ec3a0e7e3b178b9a6f019c4dfcdcc09 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-24T16:34:29.057Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `ad66860` na `feat/autocore` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 4.0.0-apex (10 modułów, 119 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | ad66860 | 0 | 2026-11-24T16:29:13.805Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | ad66860 | 0 | 2026-11-24T16:29:33.352Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | ad66860 | 0 | 2026-11-24T16:33:39.960Z | kod wyjścia 0 dla bieżącego stanu · Test Files  359 passed (359) · Tests  3026 passed (3026) |
| build | **PASS** | ad66860 | 0 | 2026-11-24T16:34:16.211Z | kod wyjścia 0 dla bieżącego stanu · built in 12.79s |
| apk | **STALE** | f5a5dc4 | — | 2026-11-24T15:46:13.562Z | APK zbudowany z f5a5dc4, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 359 · `src/lib` 309 · `src/components` 78 · `android` 64 · `docs` 30 · `(root)` 20 · `project-memory` 16 · `ios` 15 · `scripts` 15 · `proxy` 13 · `electron` 12 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `ad66860` feat(autocore): route voice TTS, liveVoice, images & memory embeddings via AutoCore + accept ADR-0002
- `ed8c129` chore(memory): autocore verified state snapshot, reports & event (ADR-0002 proposed)
- `87f78dd` feat(guardian): remote git-ref agent-lock, local guardian-daemon + systemd, APK verifier, AGENTS.md roles & AD
- `4916d35` feat(autocore): unified AI catalog, health, budget controller, A-J router, gateway, discovery & AutoCorePanel
- `5ecd05d` fix(proxy): allow Cerebras/Mistral hosts on /openai relay (were 403 with proxyUrl) + registry↔allowlist guard 

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

## Dziennik agentów (3/3 poprawnych)
- 2026-11-24T16:34:28.808Z · antigravity · `autocore-finish` → Weryfikacja APK v5-jarvis-autocore i odswiezenie memory:check --apk
- 2026-11-24T15:46:22.424Z · antigravity · `autocore` → Przeglad PR feat/autocore, ustawienie limitu budzetu w UI, opcjonalne uruchomienie scripts/install-g
- 2026-11-24T14:42:48.650Z · antigravity · `guardian-5a` → Recenzja feat/guardian-5a przez innego agenta lub właściciela (autor != jedyny recenzent), następnie
- **Następny krok (ostatnie zdarzenie):** Weryfikacja APK v5-jarvis-autocore i odswiezenie memory:check --apk

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (UNKNOWN) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
