<!-- GENERATED: scripts/sync-project-state.mjs · sha256:3835ced19a5356d6104ecec61a9897b420c7026d716b754e8e58191694afacf1 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-25T21:47:34.636Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `aff119c` na `feat/jarvis-forge-evolution` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 5.0.0-production-rc (14 modułów, 132 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | aff119c | 0 | 2026-11-25T21:40:31.610Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | aff119c | 0 | 2026-11-25T21:40:57.088Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | aff119c | 0 | 2026-11-25T21:46:19.612Z | kod wyjścia 0 dla bieżącego stanu · Test Files  375 passed (375) · Tests  3144 passed (3144) |
| build | **PASS** | aff119c | 0 | 2026-11-25T21:47:02.418Z | kod wyjścia 0 dla bieżącego stanu · built in 14.96s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 375 · `src/lib` 317 · `src/components` 80 · `android` 64 · `docs` 35 · `project-memory` 33 · `(root)` 20 · `electron` 17 · `scripts` 17 · `ios` 15 · `proxy` 13 · `forge` 12

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `aff119c` feat(forge): Adaptive Intelligence (5-tier routing & escalation), dynamic minimal teams, competitive worktree 
- `0f3f279` docs(memory): record jarvis-forge-phase2 real-world validation, FA-005..FA-007 & verified CURRENT_STATE
- `7c00e53` feat(forge): Phase 2 live-test fixes (Edit-Lint-Revert, completeness gate, Ollama inline tools, worktree porce
- `90509cf` feat(forge): Phase 2 security policy, 3-category promo budget governor, Modal bridge, worktree isolation, impa
- `eeb8cb2` docs(memory): record jarvis-forge-evolution event, ADR-0009 & verified CURRENT_STATE

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

## Dziennik agentów (14/14 poprawnych)
- 2026-11-25T21:47:34.320Z · antigravity · `jarvis-forge-adaptive-phase3` → Na fizycznym Ubuntu przetestować Adaptive Intelligence z prawdziwym darmowym API Kat. B (np. Gemini/
- 2026-11-25T20:34:44.592Z · antigravity · `jarvis-forge-phase2` → Uruchomić npm run forge:accept na fizycznym Ubuntu (Ollama 7B-14B lub darmowy klucz API), naprawić O
- 2026-11-25T18:48:22.050Z · antigravity · `jarvis-forge-evolution` → Przegląd właściciela, test z rzeczywistym darmowym kluczem API lub lokalną Ollamą na fizycznym Ubunt
- 2026-11-25T10:07:11.988Z · antigravity · `production-release-main` → Odbiór sprzętowy właściciela na fizycznym Ubuntu i telefonie Android, a następnie git push origin ma
- 2026-11-25T09:41:27.545Z · antigravity · `production-hardening` → Odbiór sprzętowy właściciela na fizycznym Ubuntu (binarka Electron + Site OS 2.0 + lokalna Ollama) i
- **Następny krok (ostatnie zdarzenie):** Na fizycznym Ubuntu przetestować Adaptive Intelligence z prawdziwym darmowym API Kat. B (np. Gemini/Cerebras/Mistral) + lokalną Ollamą 7B-14B na GPU (npm run fo

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed), ADR-0005-omni-frontier (proposed), ADR-0006-ux-obsidian-precision (proposed), ADR-0008-master-interface-and-siteos2 (proposed), ADR-0009-jarvis-forge-evolution (proposed) · nieudane podejścia: 8

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
