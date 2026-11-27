# JARVIS PHASE 4 — AUTOPILOT INTEGRATION

**Data:** 2026-11-27  
**Gałąź:** `feat/jarvis-forge-evolution` (gałąź `main` nietknięta na `8bc8e0388539c41adad1729ae796c998becfefe8`, brak merge, brak push)  
**Koszt zewnętrzny (out-of-pocket) Fazy 4:** `\$0.00` (dodatkowe zużycie kredytów promocyjnych Modal w Fazie 4: `\$0.00`, aktywnych kontenerów GPU: `0`)  
**Cel:** Przekształcić istniejące moduły Jarvisa w **jeden spójny, zerokonfiguracyjny system wykonawczy** (Autopilot Orchestrator) bez budowania drugiego routera modeli i bez usuwania działających funkcji.

---

## 1. Architektura PRZED vs PO

### PRZED (stan na końcu Fazy 3, commit `300ef5b`)
- **Jarvis Core** (`src/lib/tools.ts`, `src/lib/toolSelector.ts`, `src/lib/navIntent.ts`) **nie widział** w ogóle Jarvis Forge (`0` referencji w narzędziach czatu) — użytkownik musiał ręcznie szukać ekranu w menu i ręcznie ustawiać ścieżkę repo oraz politykę kosztu.
- **`forge/engine.mjs`** nie posiadał uniwersalnego limitu czasu zegarowego (`maxDurationMs`) dla modeli darmowych, historii prób weryfikacyjnych (`attemptHistory`) ani bramki decyzji użytkownika (`waiting_approval`).
- **`forge/memory.mjs`** parsował ADR-y i checki z `project-memory/`, ale `recallForContext()` cicho je pomijał (emitował tylko `failed-attempts.md`).
- **`forge/server.mjs`** wiązał pamięć `providerPool` wyłącznie z jednym katalogiem domyślnym (`rootDefault`), powodując wyciek `modelStats` między różnymi repozytoriami (split-brain).
- **`src/lib/forgeClient.ts`** gubił większość pól Fazy 3 (`difficulty`, `teamComposition`, `activeIntelligenceTier`, `adaptiveTrace`, `budgetSnapshot`, `securityEvents`) oraz przekazywał klucze `anthropic` i `modal` nawet w polityce `zero_cost`.
- **Izolacja `git worktree`** była domyślnie wyłączona (`useWorktree: false`) i nieaktywowana automatycznie dla zadań wieloplikowych/trudnych.

### PO (Faza 4 — Jeden Autonomiczny System Wykonawczy)

```text
   Użytkownik (1 polecenie w czacie / UI Jarvis Autopilot / CLI)
                              │
                              ▼
    ┌───────────────────────────────────────────────────┐
    │      Jarvis Core & Zero-Config UI / CLI           │
    │  • tools.ts: autopilot_run / status / decide /    │
    │              rollback (RISK + ALWAYS_CONFIRM)     │
    │  • ForgeWorkspace.tsx (1 input + Karta Decyzji)   │
    │  • forge/cli.mjs: autopilot / autopilot-plan /    │
    │                   decide                          │
    └─────────────────────────┬─────────────────────────┘
                              │ HTTP / SSE (loopback-only + token + policy guard)
                              ▼
    ┌───────────────────────────────────────────────────┐
    │   AUTOPILOT ORCHESTRATOR  (forge/autopilot.mjs)   │
    │  1. Safety Gate -> waiting_approval (deploy/push/ │
    │     rm -rf / budget_escalation)                   │
    │  2. Budget Guard -> zero_cost default, agent nie  │
    │     może podnieść limitu ani przejść na allow_paid│
    │  3. Zero-Config Limits -> czas / iteracje /       │
    │     worktree wg trudności (bez 2. routera!)       │
    └───────┬─────────────────┬────────────────┬────────┘
            │                 │                │
            ▼                 ▼                ▼
  ┌──────────────────┐ ┌─────────────┐ ┌────────────────────┐
  │ Adaptive Intel   │ │ Project &   │ │ Provider Registry  │
  │ & Agent Teams    │ │ Experience  │ │ & Budget Governor  │
  │ (adaptive.mjs)   │ │ Memory      │ │ (providers.mjs +   │
  │ • difficulty     │ │ (memory.mjs │ │  budget.mjs)       │
  │ • lean / 4-role  │ │  + ADR/     │ │ • memoryOverride   │
  │ • escalation     │ │  STATE      │ │ • Kat. A/B/C       │
  └────────┬─────────┘ └──────┬──────┘ └─────────┬──────────┘
           └──────────────────┼──────────────────┘
                              ▼
    ┌───────────────────────────────────────────────────┐
    │     FORGE ENGINE  (forge/engine.mjs)              │
    │  • Isolated Git Worktree (auto dla medium/hard)   │
    │  • Universal Wall-Clock Timeout (maxDurationMs)   │
    │  • Deterministic Verifier (0 tokenów, real tests) │
    │  • Strategy Pivot + attemptHistory + Checkpoints  │
    │  • Cross-Model Reviewer + Secret Scan + Rollback  │
    └───────────────────────────────────────────────────┘
```

### Mapa rzeczywistych połączeń wszystkich 10 modułów

| # | Moduł | Rola w Autopilocie | Rzeczywiste połączenie (dowód w kodzie) |
|---|---|---|---|
| 1 | **Jarvis Core** | Delegowanie celów z czatu/głosu + kontrola uprawnień | `src/lib/tools.ts` (`autopilot_run`, `autopilot_status`, `autopilot_decide`, `autopilot_rollback`), `src/lib/permissions.ts` (`RISK`, `ALWAYS_CONFIRM`, `CRITICAL_RISKGUARD_TOOLS`), `src/lib/toolSelector.ts` (grupa `coding`), `src/lib/navIntent.ts` (`forge`), `src/lib/selfManifest.ts` |
| 2 | **Forge Engine** | Maszyna stanów, pętla ACI, checkpointy, timeout, rollback | `forge/engine.mjs` (`executeForgeRun`, `executeCompetitiveForgeRun`, `rollbackForgeRun`, `maxDurationMs`, `attemptHistory`, `verdict`, `pendingDecision`) wywoływany przez `forge/autopilot.mjs` |
| 3 | **Adaptive Intelligence** | JEDYNY router trudności, tierów i eskalacji | `forge/adaptive.mjs` (`assessTaskDifficulty`, `composeAgentTeam`, `tierToProviderPreferences`) — wywoływany bezpośrednio przez `planAutopilotMission()` i `executeForgeRun()` |
| 4 | **Provider Registry** | Pula 14 dostawców, zdrowie, failover, uczenie per repo | `forge/providers.mjs` (`getProviderMatrix`, `selectCandidatesForRole`, `invokeForRole`) z naprawionym parametrem `memoryOverride` |
| 5 | **Agent Teams** | Minimalny zespół dobrany do trudności (`lean_2_agent` / `disciplined_4_role` / `specialist_squad` / `competitive_dual_worktree`) | `composeAgentTeam()` steruje `leanSimple` (pominięcie Architecta dla `simple`) oraz strukturą ról widoczną w UI |
| 6 | **Project Memory** | Pamięć doświadczeń + most do `project-memory/` | `forge/memory.mjs` (`recallForContext`) wstrzykuje teraz zarówno `lessons`/`failedAttempts`, jak i `ADR-*.md` (`adrsCount=8` na repo Jarvisa) oraz checki `CURRENT_STATE.json` (`projectChecksCount=4`) |
| 7 | **Budget Governor** | Niezmienialność budżetu, brak cichego `allow_paid`, Kat. A/B/C | `forge/budget.mjs` + `enforceBudgetPolicyGuard()` w `forge/autopilot.mjs` & `forge/server.mjs` + filtracja kluczy w `collectJarvisProviderKeys(costPolicy)` |
| 8 | **Git Worktree** | Automatyczna izolacja dla zadań `medium`/`hard` na czystym repo Git | `forge/worktree.mjs` (`isGitWorktreeCapable`, `createIsolatedWorktree`, `mergeWorktreesIntoRepo`, `cleanupWorktree`) włączana automatycznie w `resolveZeroConfigLimits()` |
| 9 | **Verifier** | Deterministyczne testy, analiza wpływu, bramka kompletności (0 tokenów) | `forge/engine.mjs` + `forge/repo-intel.mjs` (`analyzeChangeImpact`) zapisuje każdy cykl w `attemptHistory` i `testResults` |
| 10 | **Cross-Model Reviewer** | Niezależna recenzja diffu + skan sekretów przed `PASS` | `forge/engine.mjs` preferuje innego dostawcę/model (`preferDifferentFrom`/`preferDifferentModelFrom`) i zapisuje wynik w `state.review` |

---

## 2. Audyt integracji — wykryte luki i wprowadzone zmiany

| Luka znaleziona w audycie | Wprowadzona zmiana | Plik(i) |
|---|---|---|
| **1. Brak połączenia Core ↔ Forge** (`0` trafień w `tools.ts`) | Dodano 4 narzędzia `autopilot_run`, `autopilot_status`, `autopilot_decide`, `autopilot_rollback`, klasyfikację `RISK` + `ALWAYS_CONFIRM`, grupę `coding` w `toolSelector.ts` oraz ekran `forge` w `navIntent.ts`. | `src/lib/tools.ts`, `src/lib/permissions.ts`, `src/lib/toolSelector.ts`, `src/lib/navIntent.ts`, `src/lib/selfManifest.ts` |
| **2. Brak nadrzędnego koordynatora zero-config** | Zbudowano `forge/autopilot.mjs` (`planAutopilotMission`, `executeAutopilotMission`, `decideAutopilotMission`, `resumeAutopilotMission`, `rollbackAutopilotMission`) oparty w 100% na istniejącym `forge/adaptive.mjs` i `forge/engine.mjs` (bez 2. routera) + endpointy `/api/autopilot/plan`, `/api/autopilot/run`, `/api/autopilot/:id/decide` i komendy CLI `autopilot`, `autopilot-plan`, `decide`. | `forge/autopilot.mjs`, `forge/server.mjs`, `forge/cli.mjs` |
| **3. Brak uniwersalnego limitu czasu i historii prób** | Dodano `maxDurationMs` z `AbortController` + timerem zegarowym (zapisującym czysty checkpoint `status: "paused"`, `pauseReason: "time_limit"`), tablicę `attemptHistory` oraz jawny `verdict` (`PASS`/`PAUSED`/`BLOCKED`/`WAITING_APPROVAL`). | `forge/engine.mjs` |
| **4. Brak bramki zgody dla ryzykownych operacji i eskalacji budżetu** | Dodano deterministyczny `assessMissionSafety()` (deploy/publish/push/rm -rf/budget_escalation → `waiting_approval`) oraz `enforceBudgetPolicyGuard()` (agent otrzymuje HTTP `403 BUDGET_ESCALATION_DENIED` przy próbie podniesienia polityki i `403 SELF_APPROVAL_DENIED` przy próbie samo-zatwierdzenia; `/resume` zwraca `409 APPROVAL_REQUIRED` dla `waiting_approval`). | `forge/autopilot.mjs`, `forge/server.mjs` |
| **5. Split-brain pamięci multi-repo** | Dodano `memoryOverride` do `getProviderMatrix`, `selectCandidatesForRole` i `invokeForRole` w `forge/providers.mjs` oraz przekazano lokalną pamięć docelowego repo z `forge/engine.mjs` i `forge/server.mjs`. | `forge/providers.mjs`, `forge/engine.mjs`, `forge/server.mjs` |
| **6. Porzucane ADR-y i checki `project-memory/`** | Naprawiono `recallForContext()` i `readJarvisProjectMemoryBridge()` w `forge/memory.mjs` — ADR-y (`ADR-*.md`) i checki `CURRENT_STATE.json` trafiają teraz do kontekstu agenta i podsumowania misji. | `forge/memory.mjs` |
| **7. Wyciek płatnych/promocyjnych kluczy z UI i okrojone typy** | Rozszerzono `ForgeRunState` w `src/lib/forgeClient.ts` o pełne dane Fazy 3/4 oraz zaimplementowano `collectJarvisProviderKeys(costPolicy)` (nie przekazuje `anthropic`/`modal` w `zero_cost`/`local_only`, obsługuje `sambanova`/`cloudflare`). | `src/lib/forgeClient.ts` |
| **8. Ręczne opcje na wierzchu UI i brak karty decyzji** | Przebudowano `src/components/ForgeWorkspace.tsx` na czysty tryb zero-config (`▶ Uruchom Autopilot`, opcje ukryte w `⚙ Opcje`) z kartą `⚠ WYMAGANA DECYZJA UŻYTKOWNIKA`, statusem tieru/zespołu/postępu/limitu czasu/kosztu `$0.00`, plikami, testami i historią prób. | `src/components/ForgeWorkspace.tsx`, `src/styles/index.css` |

---

## 3. Wyniki 5 realnych scenariuszy akceptacyjnych

> **Uczciwa klasyfikacja dowodów (zgodnie z `AGENTS.md`):**
> - **`LIVE VERIFIED (bez atrap)`** — uruchomione bezpośrednio na tej maszynie VM przeciwko prawdziwemu repo `Talent620/Jarvis` (986 plików), prawdziwemu środowisku (brak Ollama, brak darmowych kluczy API w env), prawdziwemu CLI i prawdziwej przeglądarce Chromium.
> - **`LOCAL E2E VERIFIED (real HTTP/SSE + real Git/worktree + real node --test, deterministyczny adapter modelu)`** — z uwagi na brak zainstalowanej Ollamy i brak skonfigurowanych darmowych kluczy API Kat. B na tej VM (oraz twardy zakaz płatnych wywołań i dodatkowego zużycia GPU Modal w Fazie 4), w scenariuszach wymagających generacji kodu S1–S4 użyto deterministycznego adaptera modelu zarejestrowanego w prawdziwej puli `createProviderPool`, podczas gdy cały pozostały stos (**serwer HTTP/SSE `forge/server.mjs`, `forge/autopilot.mjs`, `forge/adaptive.mjs`, `forge/engine.mjs`, `git init`/`worktree`/`merge`, prawdziwe pliki na dysku, prawdziwe uruchomienia `node --test`, pamięć `ExperienceMemory`, checkpointy i rollback**) działał w 100% realnie.

| # | Scenariusz | Werdykt | Poziom weryfikacji | Co faktycznie zweryfikowano (dowody) |
|---|---|---|---|---|
| **1** | **Prosta poprawka błędu** (`src/discount.mjs` + realny `node --test`) | **PASS** | `LOCAL E2E VERIFIED` (+ live Chromium UI SSE PASS) | Zero-config `POST /api/autopilot/run` → Adaptive Intelligence zaklasyfikował `simple` (`lean_2_agent`, `leanSimple=true`, **Architect pominięty = 0 tokenów planowania**), poprawił błąd rabatu, uruchomił realne `node --test` (exit `0`), przeszedł Cross-Model Review (`free_reviewer/...`), zapisał `attemptHistory`, koszt `\$0.00`. Zweryfikowane również przez prawdziwy UI Chromium (`autopilot_completed_pass.png`). |
| **2** | **Rozbudowa funkcji w kilku plikach** (`src/validator.mjs`, `src/store.mjs`, `test/app.test.mjs`) | **PASS** | `LOCAL E2E VERIFIED` | Zero-config `POST /api/autopilot/run` → klasyfikacja `medium` (`disciplined_4_role`), **automatyczna izolacja w `git worktree`** (czyste repo Git), pierwsza próba złapana przez realne `node --test` (`FAIL`), uruchomienie Debuggera + zapis `attemptHistory` (`FAIL → PASS`), scalenie zweryfikowanych 3 plików z worktree do repo, potwierdzenie niezależnym `node --test` (`pass 2`), zapis lekcji i decyzji w `ExperienceMemory`. |
| **3** | **Stworzenie nowego modułu od zera** (`src/rateLimiter.mjs` + `test/rateLimiter.test.mjs`) | **PASS** | `LOCAL E2E VERIFIED` | Zero-config `POST /api/autopilot/run` → klasyfikacja `hard` (greenfield), izolacja `git worktree`, utworzenie obu plików od zera, realny `node --test test/rateLimiter.test.mjs` (`pass 1`, exit `0`), recenzja + skan sekretów czyste, scalenie plików do repo. |
| **4** | **Przerwanie zadania i wznowienie z checkpointu** (cancel → paused → resume → PASS + rollback) | **PASS** | `LOCAL E2E VERIFIED` + `forge-ubuntu-acceptance.mjs` (`5_pause_resume_rollback: PASS`) | Asynchroniczny start `POST /api/autopilot/run` (`HTTP 202`) → przerwanie `POST /api/runs/:id/cancel` w trakcie działania → zapis checkpointu na dysk (`status: "paused"`, `verdict: "PAUSED"`) → wznowienie `POST /api/runs/:id/resume` (`resumedCount >= 1`) → ukończenie naprawy `src/math.mjs` + realny `node --test` `PASS` → deterministyczny `rollbackAutopilotMission` przywrócił oryginalny plik (`restoredCount >= 1`). |
| **5** | **Brak dostępnego modelu LUB przekroczenie limitu** (czas / iteracje) | **PASS** (uczciwy `BLOCKED` / `PAUSED` — system zadziałał dokładnie zgodnie z kontraktem!) | **5a: `LIVE VERIFIED` (bez atrap na realnej VM!)** · **5b/5c: `LOCAL E2E VERIFIED`** | **5a (LIVE CLI bez atrap):** `node forge/cli.mjs autopilot "Napraw drobny błąd w src/lib/forgeClient.ts"` na 986-plikowym repo Jarvisa (Ollama offline, 0 kluczy API) → natychmiastowe uczciwe `BLOCKED`, `pendingDecision.kind = "no_free_provider"`, `\$0.00`, **zero** cichego przełączenia na płatny model.<br>**5b (Limit czasu):** `maxDurationMs: 90` przy wolnym wykonawcy → czyste wstrzymanie na checkpoincie (`status: "paused"`, `verdict: "PAUSED"`, `pauseReason: "time_limit"`, `pendingDecision.kind = "time_limit"`).<br>**5c (Limit iteracji/napraw):** `maxIterations: 4, maxRepairCycles: 1` przy wciąż czerwonych testach → uczciwe `BLOCKED`, `attemptHistory.length >= 1`, nigdy nie deklaruje fałszywego `PASS`. |

### Dodatkowy test bezpieczeństwa i weryfikacja UI w prawdziwej przeglądarce Chromium (Playwright + Xvfb)
- **Live CLI Safety Gate (bez atrap):** `node forge/cli.mjs autopilot "Napraw test i wykonaj git push to main oraz deploy to production"` → natychmiastowy stop w `WAITING_APPROVAL`, wykrycie obu wyzwalaczy (`production_deploy` + `git_remote_mutation`), `0` zmian w plikach; `node forge/cli.mjs decide <id> reject` → czysty `BLOCKED`.
- **Live Chromium UI E2E (`ForgeWorkspace.tsx` + live Vite `:4179` + live `forge/server.mjs` `:3220`):**
  - `zeroConfigHiddenAdvanced: true` (brak ręcznej konfiguracji na głównym ekranie),
  - `waitingApprovalCardVerified: true` (karta `⚠ WYMAGANA DECYZJA UŻYTKOWNIKA` z przyciskami `✅ Zatwierdź i wykonaj` i `🛑 Odrzuć operację`),
  - `rejectDecisionVerified: true` (kliknięcie `🛑 Odrzuć operację` → `BLOCKED`, `0` zmian),
  - `liveSsePassVerified: true` (strumień SSE na żywo → `PASS`, widoczny tier, zespół, plik, test `PASS` i wskaźnik decyzji `Nie wymagana`),
  - `consoleErrors: []`, `pageErrors: []`.
- **Regresja całego repozytorium:**
  - `npm run test:e2e:xvfb`: **10/10 PASS**
  - `npm run tools:verify`: **PASS**
  - `node scripts/forge-ubuntu-acceptance.mjs --skip-live-task`: **4 PASS · 3 WARN · 0 FAIL**
  - Pełny zestaw `npm run memory:check` (`secret-scan`, `lint`, pełny Vitest, `tsc -b && vite build`): wyniki zapisane w `project-memory/CURRENT_STATE.md`.

---

## 4. Nierozwiązane problemy i uczciwe ograniczenia

1. **Brak żywego darmowego modelu LLM na tej maszynie VM:**
   - Na kontenerze VM (`2 vCPU`, `7.8 GB RAM`, brak GPU) nie jest zainstalowana lokalna Ollama ani żaden darmowy klucz API Kat. B (`GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`). Z tego powodu pełny end-to-end z prawdziwym modelem generującym kod (S1–S4) wymaga uruchomienia na docelowej maszynie Ubuntu z Ollamą (`qwen2.5-coder:7b/14b`) lub z przynajmniej jednym darmowym kluczem Kat. B.
2. **Brak binarki Electron na tej VM:**
   - Ścieżka automatycznego uruchamiania daemona `electron/local-forge.cjs` przez IPC `ensureLocalForge` jest zweryfikowana statycznie i kontraktowo, ale wymaga finalnego testu na fizycznym desktopie Linux/Windows z zainstalowanym Electronem (`npm run forge:accept`).
3. **Ograniczenia `deploy/modal_brain.py` (z Fazy 2/3, niezmieniane w Fazie 4):**
   - Konfiguracja `Qwen2.5-Coder-14B-Instruct` w fp16 na L4 (24 GB VRAM) nadal wymaga przełączenia na `AWQ`/`GPTQ` lub `A100` zanim Modal będzie służył do ciężkich zadań (w Fazie 4 świadomie nie uruchamiano GPU Modal — zużycie `\$0.00`).
4. **Dwa istniejące silniki wysokopoziomowe w `src/lib/` (`goalRuntime.ts` vs `forge/autopilot.mjs`):**
   - `goalRuntime.ts` obsługuje cele osobisto-biznesowe (maile, leady, przypomnienia w przeglądarce/Androidzie), a `forge/autopilot.mjs` obsługuje autonomiczne zadania inżynierskie/programistyczne na repozytoriach kodu. W Fazie 4 spięto je przez 4 narzędzia Jarvis Core (`autopilot_*`), ale świadomie nie przebudowano `goalRuntime.ts` (zgodnie z zasadą nierozbijania działających modułów).

---

## 5. Decyzje wymagane od właściciela

1. **Aktywacja darmowego wykonawcy AI na docelowym środowisku:**
   - **Opcja A (zalecana — natychmiastowa, 0 USD):** Dodać w `Ustawienia → AI` przynajmniej jeden darmowy klucz Kat. B (np. **Cerebras**, **Groq**, **Gemini Free**, **Mistral**, **OpenRouter `:free`**) — Autopilot automatycznie wykryje go w RAM (bez zapisu klucza w logach Forge) i zacznie wykonywać zadania S1–S4 na prawdziwych modelach.
   - **Opcja B (100% offline, 0 USD):** Na docelowej maszynie Ubuntu zainstalować Ollamę (`ollama serve && ollama pull qwen2.5-coder:7b`) i uruchomić pełny odbiór: `npm run forge:accept`.
2. **Ewentualna poprawka `deploy/modal_brain.py` (jeśli chcesz korzystać z Kat. C w przyszłości):**
   - Decyzja, czy przejść na kwantyzację `AWQ`/`GPTQ` na L4 (`\$0.80/h`) oraz weryfikacja pozostałego salda kredytów w panelu webowym Modal (`Billed Cost = \$0.00`, ale `remainingCreditsKnown = false`).
3. **Recenzja i decyzja o scaleniu gałęzi `feat/jarvis-forge-evolution`:**
   - Gałąź `main` pozostała nietknięta. Po Twojej recenzji i ew. teście `npm run forge:accept` na fizycznym Ubuntu możemy przygotować bezpieczny merge do `main`.
