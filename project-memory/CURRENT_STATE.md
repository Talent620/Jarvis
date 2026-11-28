<!-- GENERATED: scripts/sync-project-state.mjs · sha256:d3e33062c00d2aaafd9ec99d0b7562bbc781368906f93775dd189fc1f14cd950 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-28T00:18:53.515Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `50b661e` na `feat/jarvis-forge-evolution` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 5.0.0-production-rc (16 modułów, 136 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 50b661e | 0 | 2026-11-28T00:11:26.926Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 50b661e | 0 | 2026-11-28T00:11:50.233Z | kod wyjścia 0 dla bieżącego stanu · ✖ 2 problems (0 errors, 2 warnings) |
| test | **PASS** | 50b661e | 0 | 2026-11-28T00:17:13.532Z | kod wyjścia 0 dla bieżącego stanu · Test Files  378 passed (378) · Tests  3182 passed (3182) |
| build | **PASS** | 50b661e | 0 | 2026-11-28T00:17:55.520Z | kod wyjścia 0 dla bieżącego stanu · built in 14.93s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 378 · `src/lib` 319 · `src/components` 82 · `android` 64 · `docs` 39 · `project-memory` 37 · `(root)` 20 · `electron` 18 · `scripts` 17 · `ios` 15 · `forge` 13 · `proxy` 13

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `50b661e` ci(release): fix Ubuntu workflow_dispatch publish, watch forge/** & add SHA256/OTA manifests
- `31ef908` feat(pioneer): add 1-click multi-platform Update Center, JARVIS Flow focus director & Kokpit Mocy
- `f56681d` docs(handoff): decouple handoff guide from hardcoded bundle hashes (TRANSFER-README.txt as single source of tr
- `399e20a` docs(handoff): add physical Ubuntu handoff & acceptance guide (docs/JARVIS_PHYSICAL_HANDOFF_GUIDE.md)
- `a6b8bd6` docs(memory): record jarvis-forge-phase5-closeout-acceptance event & verified CURRENT_STATE (377/377, 3170/317

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

## Dziennik agentów (18/18 poprawnych)
- 2026-11-28T00:18:53.239Z · antigravity · `jarvis-v6-pioneer-updater-flow` → Wypchnąć gałąź feat/jarvis-forge-evolution (bez ruszania main), uruchomić workflow CI dla Ubuntu (.A
- 2026-11-27T16:28:44.690Z · antigravity · `jarvis-forge-phase5-closeout-acceptance` → Wykonać manualny odbiór fizycznego Ubuntu wg sekcji E.2 docs/JARVIS_FINAL_ACCEPTANCE.md (npm install
- 2026-11-27T15:49:11.760Z · antigravity · `jarvis-forge-phase5-real-autonomy` → Niezależny przegląd feat/jarvis-forge-evolution przez właściciela; opcjonalnie dodanie darmowego klu
- 2026-11-27T12:13:57.798Z · antigravity · `jarvis-forge-phase4-autopilot` → Skonfigurować darmowy klucz Kat. B lub lokalną Ollamę na docelowym Ubuntu i uruchomić npm run forge:
- 2026-11-25T21:47:34.320Z · antigravity · `jarvis-forge-adaptive-phase3` → Na fizycznym Ubuntu przetestować Adaptive Intelligence z prawdziwym darmowym API Kat. B (np. Gemini/
- **Następny krok (ostatnie zdarzenie):** Wypchnąć gałąź feat/jarvis-forge-evolution (bez ruszania main), uruchomić workflow CI dla Ubuntu (.AppImage/.deb), Windows (.exe) i Androida (.apk) oraz zweryfi

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed), ADR-0005-omni-frontier (proposed), ADR-0006-ux-obsidian-precision (proposed), ADR-0008-master-interface-and-siteos2 (proposed), ADR-0009-jarvis-forge-evolution (proposed) · nieudane podejścia: 9

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
