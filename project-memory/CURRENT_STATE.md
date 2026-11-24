<!-- GENERATED: scripts/sync-project-state.mjs · sha256:c992e982b10df08246c180029610728e862db80939ffc8dbe0d6befe2cc2c394 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-24T21:21:57.759Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `debb484` na `feat/ux-craft-audit` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 4.0.0-apex (11 modułów, 131 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | debb484 | 0 | 2026-11-24T21:16:04.271Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | debb484 | 0 | 2026-11-24T21:16:24.548Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | debb484 | 0 | 2026-11-24T21:20:44.598Z | kod wyjścia 0 dla bieżącego stanu · Test Files  366 passed (366) · Tests  3093 passed (3093) |
| build | **PASS** | debb484 | 0 | 2026-11-24T21:21:25.587Z | kod wyjścia 0 dla bieżącego stanu · built in 13.59s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 366 · `src/lib` 315 · `src/components` 79 · `android` 64 · `docs` 30 · `project-memory` 23 · `(root)` 20 · `electron` 16 · `ios` 15 · `scripts` 15 · `proxy` 13 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `debb484` fix(ux): second-pass visual polish — top-right desktop toast, active chip hover, cmdk input border, wrapped th
- `bcd8b65` feat(ux): decluttered topbar & Lucide icons, collapsible FitnessPanel, clean Settings/Guardian/CommandPalette 
- `6c0a62e` feat(ux): unified Obsidian Precision design system, true Light theme, dark form controls & BossFab/Toast/mobil
- `a00b8ae` chore(memory): verified omni-frontier snapshot, reports & event (ADR-0005 proposed)
- `6df9e80` feat(omni-frontier): Hybrid OS-Tree+Vision grounding, Dual-Track Screen Sentinel (0-USD static skip), HUD deci

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

## Dziennik agentów (7/7 poprawnych)
- 2026-11-24T21:21:57.501Z · antigravity · `ux-craft-audit` → Recenzja PR feat/ux-craft-audit przez właściciela lub innego agenta, scalenie z main oraz test docel
- 2026-11-24T20:46:19.696Z · antigravity · `omni-frontier` → Recenzja PR feat/omni-frontier (ADR-0003/0004/0005) i test na żywym pulpicie Linux/Windows; następni
- 2026-11-24T20:28:42.588Z · antigravity · `omni-pilot` → Recenzja PR feat/omni-pilot (ADR-0004) i test na żywym pulpicie Linux X11/Wayland lub Windows; po ak
- 2026-11-24T19:58:10.291Z · antigravity · `apex-polish` → Recenzja i merge PR feat/apex-polish -> main, a nastepnie build Linux (.AppImage/.deb) i nowego APK 
- 2026-11-24T16:34:28.808Z · antigravity · `autocore-finish` → Weryfikacja APK v5-jarvis-autocore i odswiezenie memory:check --apk
- **Następny krok (ostatnie zdarzenie):** Recenzja PR feat/ux-craft-audit przez właściciela lub innego agenta, scalenie z main oraz test docelowy na fizycznym Android APK (Samsung S9+) i Linux Desktop.

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed), ADR-0005-omni-frontier (proposed), ADR-0006-ux-obsidian-precision (proposed) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
