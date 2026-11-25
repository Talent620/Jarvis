<!-- GENERATED: scripts/sync-project-state.mjs · sha256:2126d025936001cbf3df519c9f8e29ad00d62f94fdbf16b7513363a5c233863c · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-25T09:41:27.829Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `803f8bd` na `fix/production-integration` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: NONE
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 5.0.0-production-rc (13 modułów, 132 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 803f8bd | 0 | 2026-11-25T09:35:25.078Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 803f8bd | 0 | 2026-11-25T09:35:47.065Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | 803f8bd | 0 | 2026-11-25T09:40:45.714Z | kod wyjścia 0 dla bieżącego stanu · Test Files  372 passed (372) · Tests  3125 passed (3125) |
| build | **PASS** | 803f8bd | 0 | 2026-11-25T09:41:27.219Z | kod wyjścia 0 dla bieżącego stanu · built in 14.82s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 372 · `src/lib` 316 · `src/components` 79 · `android` 64 · `docs` 32 · `project-memory` 28 · `(root)` 20 · `electron` 16 · `scripts` 16 · `ios` 15 · `proxy` 13 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `803f8bd` docs(audit): preserve branch acceptance audit & add production hardening report
- `a2d306e` fix(ui,a11y): unify focus-trap & ARIA across all 34 sheets, fix toast/sheet overlap & light theme input
- `cfe208e` fix(site-os): isolate /p/:id with CSP sandbox, harden /api/session, cap SSE & separate LAN/tunnel
- `b020365` docs(memory): record master-interface-polish event, ADR-0008 & verified CURRENT_STATE (370/370 suites, 3114/31
- `6c9e13a` test(e2e): wait for React mount & Boot screen teardown cleanly in e2e-xvfb-probe

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

## Dziennik agentów (10/10 poprawnych)
- 2026-11-25T09:41:27.545Z · antigravity · `production-hardening` → Odbiór sprzętowy właściciela na fizycznym Ubuntu (binarka Electron + Site OS 2.0 + lokalna Ollama) i
- 2026-11-25T06:41:22.297Z · antigravity · `master-interface-polish` → Odbiór wizualny i sprzętowy właściciela na fizycznym Ubuntu oraz przetestowanie warsztatu Site OS 2.
- 2026-11-24T23:20:07.805Z · antigravity · `production-integration` → Wykonać 10-15 min checklistę odbiorczą na fizycznym Linuxie (Ollama + binarny Electron + X11/Wayland
- 2026-11-24T21:21:57.501Z · antigravity · `ux-craft-audit` → Recenzja PR feat/ux-craft-audit przez właściciela lub innego agenta, scalenie z main oraz test docel
- 2026-11-24T20:46:19.696Z · antigravity · `omni-frontier` → Recenzja PR feat/omni-frontier (ADR-0003/0004/0005) i test na żywym pulpicie Linux/Windows; następni
- **Następny krok (ostatnie zdarzenie):** Odbiór sprzętowy właściciela na fizycznym Ubuntu (binarka Electron + Site OS 2.0 + lokalna Ollama) i promocja fix/production-integration na main.

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed), ADR-0005-omni-frontier (proposed), ADR-0006-ux-obsidian-precision (proposed), ADR-0008-master-interface-and-siteos2 (proposed) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
