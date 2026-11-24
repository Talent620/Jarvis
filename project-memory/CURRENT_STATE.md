<!-- GENERATED: scripts/sync-project-state.mjs · sha256:2aafb28d367e21b125b3f3e74d5c72ef3a2defcf62e5760aae30d9c73d6a6210 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-24T20:28:42.855Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `67895c2` na `feat/omni-pilot` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 4.0.0-apex (11 modułów, 127 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 67895c2 | 0 | 2026-11-24T20:22:48.513Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 67895c2 | 0 | 2026-11-24T20:23:09.275Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | 67895c2 | 0 | 2026-11-24T20:27:28.435Z | kod wyjścia 0 dla bieżącego stanu · Test Files  365 passed (365) · Tests  3076 passed (3076) |
| build | **PASS** | 67895c2 | 0 | 2026-11-24T20:28:08.637Z | kod wyjścia 0 dla bieżącego stanu · built in 13.87s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 365 · `src/lib` 314 · `src/components` 79 · `android` 64 · `docs` 30 · `(root)` 20 · `project-memory` 20 · `ios` 15 · `scripts` 15 · `electron` 14 · `proxy` 13 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `67895c2` fix(omni-pilot): tighten TypeScript union narrowing in desktop.ts pilot catch fallbacks
- `90d170d` feat(omni-pilot): wire hands-free voice reflex & visual grounding into HeadsetMode (Ctrl+Shift+J) and BossMode
- `a15daf1` fix(omni-pilot): scale HiDPI coordinates by display scaleFactor & fix Windows PowerShell mouse/scroll/SendKeys
- `7976912` feat(omni-pilot): live Visual Grounding HUD reticle, 8 agent tools, voice-to-desktop App wiring & ADR-0004
- `c1fc5e6` feat(omni-pilot): Polish voice reflex, [0..1000] visual grounding, RiskGuard & autonomous Computer Use loop

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

## Dziennik agentów (5/5 poprawnych)
- 2026-11-24T20:28:42.588Z · antigravity · `omni-pilot` → Recenzja PR feat/omni-pilot (ADR-0004) i test na żywym pulpicie Linux X11/Wayland lub Windows; po ak
- 2026-11-24T19:58:10.291Z · antigravity · `apex-polish` → Recenzja i merge PR feat/apex-polish -> main, a nastepnie build Linux (.AppImage/.deb) i nowego APK 
- 2026-11-24T16:34:28.808Z · antigravity · `autocore-finish` → Weryfikacja APK v5-jarvis-autocore i odswiezenie memory:check --apk
- 2026-11-24T15:46:22.424Z · antigravity · `autocore` → Przeglad PR feat/autocore, ustawienie limitu budzetu w UI, opcjonalne uruchomienie scripts/install-g
- 2026-11-24T14:42:48.650Z · antigravity · `guardian-5a` → Recenzja feat/guardian-5a przez innego agenta lub właściciela (autor != jedyny recenzent), następnie
- **Następny krok (ostatnie zdarzenie):** Recenzja PR feat/omni-pilot (ADR-0004) i test na żywym pulpicie Linux X11/Wayland lub Windows; po akceptacji merge do main, build Linux (.AppImage/.deb) i APK o

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
