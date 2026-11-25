# ADR-0009: JARVIS FORGE — Autonomiczne Środowisko Programistyczne (Autonomous Evolution)

- **Status:** proposed
- **Data:** 2026-11-25
- **Autor:** antigravity
- **Zakres:** `forge/*`, `electron/local-forge.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `src/lib/forgeClient.ts`, `src/components/ForgeWorkspace.tsx`, `src/lib/permissions.ts`, `src/lib/freeMode.ts`, `src/lib/providers/openai.ts`, `electron/workspace-tools.cjs`, `docs/FORGE_ARCHITECTURE.md`

## Kontekst
Przeprowadzony audyt pełnego repozytorium (`main` @ `8bc8e03`) wykazał:
1. Słowo `Forge` w repozytorium dotyczyło dotąd wyłącznie Stable Diffusion WebUI Forge (`:7860`).
2. Plan rozbudowy `R1–R4` w `docs/JARVIS_REPAIR_PLAN.md` miał jedynie niepodpięte lub zablokowane fundamenty:
   - `agentPipeline.ts` był 55-liniową nakładką etykietującą bez realnych ról;
   - `agentRun.ts:makeDefaultExecTool` potwierdzał (`CONFIRMED`) wyłącznie 4 lokalne odczyty, blokując kroki zależne narzędzi plikowych/terminalowych;
   - 11 z 12 narzędzi `system_*` z `systemMcp.ts` brakowało w mapie `RISK` w `permissions.ts` (+ literówka `system_generated_tool` vs `system_generate_tool`);
   - `electron/workspace-tools.cjs` nie posiadał chirurgicznych edycji `SEARCH/REPLACE`, `grep`, paginowanego odczytu linii, mapy repozytorium ani wznawianych checkpointów, a `BLOCKED_ARGS` blokował legalne flagi `--format` / `npm run format`;
   - pętla `providers/*.ts` miała twardy limit `guard < 8` wywołań narzędzi i watchdog 75 s bez `AbortSignal`, zaś `providers/openai.ts` nie przekazywał nagłówka `Retry-After` do `autocore/health.ts`;
   - `project-memory/` nie było powiązane z pamięcią wykonawczą aplikacji, a w runtime brakowało pamięci doświadczeń (`błąd → zweryfikowane rozwiązanie`, `nieudane próby`, `skuteczność modeli i strategii`).

## Decyzja
1. **Dedykowany silnik `forge/` w czystym Node.js 22 ESM (0 nowych zależności npm)** na wzór sprawdzonego i utwardzonego `site-os/`:
   - `forge/repo-intel.mjs` — deterministyczny skaner repozytorium, ekstraktor symboli i grafu zależności, ranking istotności (Aider-inspired Repo Map) i auto-detekcja komend test/lint/typecheck/build oraz reguł z `AGENTS.md`.
   - `forge/workspace.mjs` — Agent-Computer Interface (ACI) dla dowolnego repozytorium z twardą granicą katalogu (`realpathSync`), paginowanym `read_file`, `search_code`, chirurgicznym `edit_file` (`SEARCH/REPLACE` + natychmiastowa kontrola składni + unified diff), bezpiecznym `run_command` bez `shell: true` i z ubijaniem drzewa procesów, skanerem/redaktorem sekretów oraz pełnym `rollbackRun` z migawek sprzed edycji.
   - `forge/providers.mjs` — wymienialna siatka 14 dostawców z 4-klasową taksonomią kosztów (`local`, `free_api`, `promo_credit`, `paid`), profilerem sprzętu (`CPU/RAM/VRAM/Ollama`), domyślną twardą polityką `zero_cost` (`0 USD`), obsługą `Retry-After` oraz routerem per rola uczącym się na realnych wynikach testów.
   - `forge/memory.mjs` — Verified Experience Memory (`.jarvis-forge/memory.json` + odczyt `project-memory/`): architektura, decyzje (R3), zweryfikowane pary `errorSignature → verifiedFix` z `utilityScore`, rejestr nieudanych prób (anti-loop), skuteczność modeli i strategii oraz historia zadań.
   - `forge/engine.mjs` — 5-rolna, zdyscyplinowana maszyna stanów (`Scout/Architect`, `Developer`, deterministyczny `Verifier`, `Debugger & Strategist`, niezależny `Reviewer`) z trwałymi checkpointami po każdym kroku, event-sourced `events.jsonl`, `resumeRun`, **Context Condenserem**, **Verify-Before-Success Gate** (zero fałszywych sukcesów!) oraz **Strategy Pivoting** przy powtarzających się błędach.
   - `forge/server.mjs` + `forge/cli.mjs` + `electron/local-forge.cjs` — lokalny serwer loopback (`127.0.0.1:3220`) z tokenem sesyjnym, ochroną anty-DNS-rebinding i SSE, dostępny równocześnie z CLI, przeglądarki i Electron Desktop.
2. **Prosty, skupiony interfejs `src/components/ForgeWorkspace.tsx` (`<Modal>`, ES2019/S9-safe)** z jednym głównym poleceniem („Co mam zbudować, naprawić lub ulepszyć?”) i żywym podglądem 10 wymaganych obszarów (cel, plan, etap, wykonawca, postęp, działania, testy, diffy plików, problemy/blokady, rezultat + `Pauza / Wznów / Cofnij`).
3. **Chirurgiczne poprawki jądra Jarvisa bez naruszania odłożonych decyzji właściciela:** uzupełnienie `RISK` dla `system_*` i naprawa literówki `system_generate_tool` w `permissions.ts`, model-level strażnik `:free` w `freeMode.ts`, przekazywanie `status` i `retryAfter` w `providers/openai.ts`, oraz doprecyzowanie `BLOCKED_ARGS` w `electron/workspace-tools.cjs`.

## Konsekwencje
- Istniejące 372 pliki testowe i gałąź `main` pozostają w pełni kompatybilne i nienaruszone (praca na dedykowanej gałęzi `feat/jarvis-forge-evolution`).
- System działa przy 0 USD na dowolnej kombinacji lokalnej Ollamy i darmowych kluczy API, a dostawcy mogą być dodawani lub wymieniani w jednym rejestrze bez przebudowy Jarvisa.
- Brak zewnętrznych zależności npm utrzymuje zerowy narzut na rozmiar bundla i bezpieczeństwo łańcucha dostaw.
