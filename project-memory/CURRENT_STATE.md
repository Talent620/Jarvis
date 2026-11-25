<!-- GENERATED: scripts/sync-project-state.mjs · sha256:3131908ff0b53b92bcaed0da625dfcbb687b6f8a62c139e12d4f9b089b124607 · DO NOT EDIT -->
# JARVIS — CURRENT STATE (generowany)

> Wygenerowano 2026-11-25T10:07:12.303Z przez `scripts/sync-project-state.mjs`. **Nie edytuj ręcznie** — `npm run memory:sync`.
> Statusy: PASS tylko z rzeczywistego uruchomienia dla bieżącego commita i drzewa; brak danych = UNKNOWN.

## Repozytorium
- Commit `97544a5` na `main` · zmiany w drzewie (poza project-memory): TAK
- Zdalne: origin → github.com (https) · upstream: origin/main
- Projekt: jarvis-ai-assistant@2.0.0 · manifest JARVIS 5.0.0-production-rc (13 modułów, 132 narzędzi)

## Weryfikacja (rzeczywiste uruchomienia)
| Check | Status | Commit | Kod | Kiedy | Szczegóły |
|---|---|---|---|---|---|
| secret-scan | **PASS** | 97544a5 | 0 | 2026-11-25T10:00:59.487Z | kod wyjścia 0 dla bieżącego stanu · Skan sekretów: czysto. |
| lint | **PASS** | 97544a5 | 0 | 2026-11-25T10:01:22.025Z | kod wyjścia 0 dla bieżącego stanu |
| test | **PASS** | 97544a5 | 0 | 2026-11-25T10:06:25.912Z | kod wyjścia 0 dla bieżącego stanu · Test Files  372 passed (372) · Tests  3125 passed (3125) |
| build | **PASS** | 97544a5 | 0 | 2026-11-25T10:07:11.601Z | kod wyjścia 0 dla bieżącego stanu · built in 17.85s |
| apk | **STALE** | 2afee4f | — | 2026-11-24T16:46:50.811Z | APK zbudowany z 2afee4f, nie z HEAD · v4-jarvis-apex-safe · jarvis-apex-v4.apk |

## Główne moduły (pliki śledzone)
`tests` 372 · `src/lib` 316 · `src/components` 79 · `android` 64 · `docs` 33 · `project-memory` 29 · `(root)` 20 · `electron` 16 · `scripts` 16 · `ios` 15 · `proxy` 13 · `QA` 11

## Workflowy CI
`android-v2.yml` (workflow_dispatch/push) · `android.yml` (push/workflow_dispatch) · `deploy-modal.yml` (workflow_dispatch) · `ios.yml` (workflow_dispatch/push) · `ollama-exe.yml` (workflow_dispatch/push) · `release.yml` (workflow_dispatch/push) · `sd-exe.yml` (workflow_dispatch/push) · `test.yml` (push/pull_request/workflow_dispatch) · `ubuntu.yml` (workflow_dispatch/pull_request/push) · `windows.yml` (workflow_dispatch/push)

## Ostatnie commity
- `97544a5` docs(release): add JARVIS_PRODUCTION_RELEASE.md for main fast-forward merge
- `0a0f53f` docs(memory): record production-hardening event & verified CURRENT_STATE (372/372 suites, 3125/3125 tests)
- `803f8bd` docs(audit): preserve branch acceptance audit & add production hardening report
- `a2d306e` fix(ui,a11y): unify focus-trap & ARIA across all 34 sheets, fix toast/sheet overlap & light theme input
- `cfe208e` fix(site-os): isolate /p/:id with CSP sandbox, harden /api/session, cap SSE & separate LAN/tunnel

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

## Dziennik agentów (11/11 poprawnych)
- 2026-11-25T10:07:11.988Z · antigravity · `production-release-main` → Odbiór sprzętowy właściciela na fizycznym Ubuntu i telefonie Android, a następnie git push origin ma
- 2026-11-25T09:41:27.545Z · antigravity · `production-hardening` → Odbiór sprzętowy właściciela na fizycznym Ubuntu (binarka Electron + Site OS 2.0 + lokalna Ollama) i
- 2026-11-25T06:41:22.297Z · antigravity · `master-interface-polish` → Odbiór wizualny i sprzętowy właściciela na fizycznym Ubuntu oraz przetestowanie warsztatu Site OS 2.
- 2026-11-24T23:20:07.805Z · antigravity · `production-integration` → Wykonać 10-15 min checklistę odbiorczą na fizycznym Linuxie (Ollama + binarny Electron + X11/Wayland
- 2026-11-24T21:21:57.501Z · antigravity · `ux-craft-audit` → Recenzja PR feat/ux-craft-audit przez właściciela lub innego agenta, scalenie z main oraz test docel
- **Następny krok (ostatnie zdarzenie):** Odbiór sprzętowy właściciela na fizycznym Ubuntu i telefonie Android, a następnie git push origin main.

## Decyzje: ADR-0001-project-memory (proposed (czeka na recenzję człowieka lub innego agenta)), ADR-0002-autocore (accepted), ADR-0003-apex-linux-android-ux (proposed), ADR-0004-omni-pilot (proposed), ADR-0005-omni-frontier (proposed), ADR-0006-ux-obsidian-precision (proposed), ADR-0008-master-interface-and-siteos2 (proposed) · nieudane podejścia: 5

## Ostrzeżenia
- brakujące dokumenty referencyjne: docs/JARVIS_CONTROL_CENTER.md, JARVIS_BACKLOG.md, JARVIS_NEXT.md
