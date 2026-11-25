# JARVIS FORGE — Audyt, Badania i Architektura Autonomicznego Środowiska Programistycznego

> Dokument bazowy inicjatywy **JARVIS FORGE — AUTONOMOUS EVOLUTION** (`feat/jarvis-forge-evolution`, `ADR-0009`).
> Oparty wyłącznie na faktach z kodu repozytorium (`main` @ `8bc8e03`), weryfikacji sprzętu środowiska wykonawczego oraz badaniu obecnego stanu sztuki (2025–2026).

---

## 1. Wyniki audytu całego projektu JARVIS

### 1.1. Stan faktyczny „Jarvis Forge” przed ewolucją
- **W całym repozytorium oraz wszystkich 11 gałęziach Git słowo `Forge` dotyczyło wyłącznie generatora obrazów Stable Diffusion WebUI Forge (`:7860`).**
- Autonomiczny silnik programistyczny istniał jedynie jako wizja rozbudowy **`R1–R4`** w `docs/JARVIS_REPAIR_PLAN.md` (`Planner -> Coder -> Tester -> Debugger -> Reviewer`, pamięć decyzji, Centrum Autonomii) oraz zbiór rozproszonych, częściowo niedokończonych klocków.

### 1.2. Co działa świetnie i stanowi fundament do wykorzystania (nie do duplikowania)
1. **`src/lib/autocore/*` (`ADR-0002`):** katalog 12 dostawców, trwały stan zdrowia kluczy/modeli/dostawców (`health.ts`), bramka budżetowa (`budget.ts`), klasyfikacja zadań A–J (`router.ts`), wspólny kontrakt `gateway.ts` i odkrywanie modeli `/models` (`discovery.ts`).
2. **`electron/workspace-tools.cjs` + `electron/mcp-stdio.cjs`:** działające adaptery Node.js z twardą granicą katalogu (`inside()` + `fs.realpathSync`), audytem JSONL i oficjalnym klientem `@modelcontextprotocol/sdk` (`1.29.0`).
3. **Wzorzec lokalnego serwera-towarzysza (`site-os/server.mjs` + `electron/local-siteos.cjs`):** sprawdzony i utwardzony w audycie `F-01` wzorzec lokalnego procesu Node.js na `127.0.0.1` z tokenem sesyjnym, SSE i automatycznym uruchamianiem z Electrona — działający jednocześnie z przeglądarki, Electrona i CLI.
4. **`project-memory/*`:** odporna, weryfikowalna pamięć repozytorium (`CURRENT_STATE.json`, `events/*.json`, `decisions/ADR-*.md`, `journal/failed-attempts.md`, redakcja sekretów).
5. **UI Jarvisa (`Modal.tsx` z `useModalFocusTrap`, Obsidian Precision / Light / Editorial, `CommandPalette`, `More.tsx`):** spójny, dostępny, przetestowany w Chromium i zgodny z ES2019 (Chrome 79 / Samsung S9).

### 1.3. Zidentyfikowane luki, martwy kod i blokady autonomii
| Obszar | Rzeczywista usterka / luka w `main` (`8bc8e03`) | Wpływ na autonomię kodowania |
|---|---|---|
| `src/lib/agentPipeline.ts` | 55-liniowa atrapa etykietująca kroki regexem nad `runPlan` bez realnych ról | Brak planowania, edycji, testowania, debugowania i recenzji |
| `src/lib/agentRun.ts:220-241` | `makeDefaultExecTool` potwierdza (`CONFIRMED`) tylko 4 lokalne odczyty; reszta daje `ATTEMPTED` | Zależne kroki planu wielokrokowego są automatycznie pomijane |
| `src/lib/permissions.ts` | Brak 11/12 narzędzi `system_*` w `RISK` + literówka `system_generated_tool` vs `system_generate_tool` | Nawet `system_files_read` wpada w `outbound`; zapis/terminal wymagają ręcznego kliku |
| `electron/workspace-tools.cjs` | Brak `grep`, `glob`, zakresu linii, `SEARCH/REPLACE`, rollbacku; sztywny root `~/Documents/JARVIS Workspace`; `BLOCKED_ARGS` blokuje `--format` i `npm run format` | Nie da się chirurgicznie edytować dowolnego repo ani uruchamiać części komend |
| `src/lib/providers/*.ts` + `brain.ts` | Twardy limit `guard < 8` tur narzędzi; watchdog 75 s bez `AbortSignal`; brak przekazywania `Retry-After` w `openai.ts`; brak kompakcji kontekstu dla chmury | Złożone zadania kodujące są ucinane w połowie lub grożą podwójnym wykonaniem |
| `src/lib/freeMode.ts` | `freeOnly()` filtruje tylko `provider`, przepuszczając płatny model OpenRoutera (bez `:free`) | Ryzyko przypadkowego użycia płatnego modelu w trybie darmowym |
| Pamięć (`src/lib/*` vs `project-memory/`) | 6+ nakładających się magazynów w `localStorage`/`IndexedDB`; zero połączenia z `project-memory/`; brak pamięci `błąd → rozwiązanie`, `nieudane próby` i `skuteczność modeli/strategii` | Agent powtarza te same błędy i nie uczy się skuteczności modeli |
| Zdublowane planery / dead code | 6 równoległych mechanizmów planowania + 8 plików test-only (`skills.ts`, `mcpBridge.ts`, `growthFlowCoordinator.ts`, `horizon/mcpDevice.ts`, itd.) | Rozproszenie odpowiedzialności (zdiagnozowane wcześniej w `SYSTEM_XRAY.md`) |

*(Wszystkie świadomie odłożone decyzje właściciela z `docs/DEVLOG.md` / `PROGRESS.md` — `admin.ts`, keystore/EXE, `release.yml`, `REQUIRE_APP_TOKEN`, `AudioWorklet`, Live consent — pozostają nietknięte.)*

---

## 2. Synteza badań architektur autonomicznych agentów (2025–2026)

| System / Wzorzec | Najmocniejsza strona, którą adaptujemy | Ograniczenie, które eliminujemy w Jarvis Forge |
|---|---|---|
| **Aider** | **Repository Map** (graf symboli + ranking istotności) + chirurgiczny format **`SEARCH/REPLACE`** + czyste diffy/rollback Git | Brak pętli autonomicznego debugowania z wieloma strategiami i brak trwałej pamięci doświadczeń |
| **SWE-agent (ACI)** | **Agent-Computer Interface:** okna odczytu z numerami linii, natychmiastowa walidacja składni przy edycji, zwięzłe logi błędów | Ciężkie środowisko kontenerowe; słaby routing wielomodelowy pod limity darmowych API |
| **OpenHands V1 SDK** | **Event-Sourced State** + **Context Condenser** + oddzielenie silnika/serwera HTTP+SSE od UI | Duży narzut infrastrukturalny Python/Docker; brak natywnego trybu zero-cost pool |
| **Claude Code / Codex Harness** | Zdyscyplinowana zamknięta pętla **Verify-Before-Success**, kompresja kontekstu dla długich horyzontów, MCP | Zależność od jednego komercyjnego dostawcy / płatnych tokenów |
| **Cline / Roo Code / LangGraph** | Jawne role trybów (Architect/Code/Debug/Review), trwałe checkpointy i wznawianie po awarii | Częsta utrata kontekstu na mniejszych darmowych modelach bez kondensacji i pamięci porażek |
| **Reflexion / MemRL / ReasoningBank** | Pamięć doświadczeń z oddzielnym indeksowaniem **zweryfikowanych sukcesów** i **nieudanych prób** (`utilityScore`) | W literaturze często brak twardej bramki dowodowej (zapis dopiero po realnym `FAIL → PASS` w testach) |

**Czego brakuje dzisiejszym agentom — przewaga Jarvis Forge:**
1. **Zero-Cost Multi-Provider Mesh z pamięcią skuteczności** (łączenie puli darmowych API + lokalnego CPU/GPU Ollamy z automatycznym przełączaniem po `429 Retry-After` i uczeniem się, który darmowy model najlepiej radzi sobie w konkretnej roli).
2. **Evidence-Gated Experience Memory** (każda lekcja `błąd → rozwiązanie` trafia do pamięci **wyłącznie** po potwierdzonym przejściu testu z `FAIL` na `PASS`, a nieudane strategie są indeksowane jako twardy anti-loop).
3. **Deterministyczny Strategy Pivot** (wykrycie tej samej sygnatury błędu 2× wymusza zmianę strategii i/lub eskalację na inny model z puli, zamiast bezmyślnego powtarzania pętli).

---

## 3. Macierz bezpłatnych zasobów AI i analiza sprzętu (stan zweryfikowany: listopad 2026)

Rozróżniamy **4 ścisłe klasy kosztów** (domyślna polityka Forge `zero_cost` dopuszcza **wyłącznie `local` i `free_api` — gwarancja 0 USD**):

| Klasa | Dostawca | Typowy limit darmowy (2026) | Najlepsza rola w Forge | Uwagi, wymagania i ryzyka |
|---|---|---|---|---|
| **`local`** | **Ollama** | Bez limitów, 100% offline i prywatne | Scout/kompakcja, proste edycje, pełna praca offline | Zależy od sprzętu (dobór modelu pod wykryty RAM/VRAM) |
| **`free_api`** | **Google Gemini (AI Studio)** | ~10–15 RPM, 250–1500 RPD (Flash/Flash-Lite), bez karty | **Architect / Reviewer** (długi kontekst, mocny tool-calling) | Limity per projekt (reset północ PT); w free tier Google może używać promptów do ulepszania usług — nie wysyłać sekretów! |
| **`free_api`** | **Cerebras** | ~1M tokenów/dzień, 5–30 RPM, ~2000 tok/s, bez karty | **Developer / szybkie iteracje Debugger** | Świetny stosunek szybkości do limitu dziennego |
| **`free_api`** | **Groq** | 30 RPM, ~1000 RPD, **ciasne ~8K TPM / 200K TPD**, bez karty | **Developer / szybkie poprawki** (z kompaktowanym kontekstem!) | Ciasny TPM wymaga naszej Repo Map + Context Condensera |
| **`free_api`** | **Mistral (Experiment)** | Do ~1 mld tokenów/mies., 1 req/s, bez karty (wymaga tel.) | **Developer (`codestral` / `mistral-small`) / Architect** | Wymaga weryfikacji numeru telefonu; szybkie rotacje wersji modeli |
| **`free_api`** | **OpenRouter (`:free`)** | 20 RPM, 50 RPD (1000 RPD po jednorazowym doładowaniu $10) | **Eskalacja / Cross-Model Reviewer** | **Twarda blokada:** w trybie `zero_cost` Forge dopuszcza WYŁĄCZNIE ID kończące się na `:free`! |
| **`free_api`** | **NVIDIA NIM** | Darmowy katalog API dla członków Developer Program (~40 RPM) | **Developer (`qwen2.5-coder-32b`) / Debugger (`deepseek-r1`)** | Wymaga konta Developer / weryfikacji telefonu; przeznaczenie dev/prototyp |
| **`free_api`** | **GitHub Models** | ~10–15 RPM, 50–150 RPD (zależnie od klasy modelu), bez karty | **Reviewer / Architect** (`openai/gpt-4.1-mini`, `DeepSeek-R1`) | Wymaga tokena GitHub; mały limit dzienny — rezerwować na krytyczne kroki |
| **`free_api`** | **SambaNova** | Darmowy tier OpenAI-compat z limitami RPM/RPD, bez karty | **Developer (`Qwen2.5-Coder-32B`, `Llama-3.3-70B`)** | Dobre uzupełnienie puli przy `429` na Groq/Cerebras |
| **`free_api`** | **Cloudflare Workers AI** | **10 000 Neurons / dzień** (reset 00:00 UTC) | **Lekki fallback / kompakcja / klasyfikacja** | Wymaga `CF_ACCOUNT_ID` + `CF_API_TOKEN`; na planie Paid powyżej 10K nalicza $0.011/1K neurons → trzymać na Workers Free |
| **`free_api`** | **Cohere (Trial)** | 20 RPM, 1000 wywołań/mies., bez karty | **Rezerwa Planner / Reviewer** | Niski limit miesięczny, używać jako fallback |
| **`promo_credit`** | **Modal (Serverless GPU)** | $30/mies. darmowych kredytów GPU | Wyłączone w `zero_cost` (tylko jawny opt-in) | Ryzyko naliczenia po przekroczeniu $30 + cold start >20 s (`FA-005`) |
| **`promo_credit`** | **Hugging Face Inference** | $0.10/mies. kredytów dla darmowego konta | Wyłączone w `zero_cost` (zbyt mały limit) | Praktycznie tylko do pojedynczych sond |
| **`paid`** | **Anthropic / płatne modele** | Rozliczane za token | **Twardo zablokowane w `zero_cost`** | Odblokowywane wyłącznie na jawny wybór `allow_paid` z limitem USD |

### Realny profil sprzętu i inteligentny podział pracy
- **Środowisko obecnej VM:** 2 vCPU, 7.8 GB RAM (6.4 GB wolne), brak GPU (`NO_GPU`), brak zainstalowanej Ollamy (`NO_OLLAMA`), brak kluczy API w zmiennych środowiskowych.
- **Inteligentny podział Local ↔ Free Cloud (wbudowany w `forge/providers.mjs:detectHardwareProfile`):**
  - **0 tokenów (CPU lokalnie zawsze):** skan repozytorium, graf zależności, wyszukiwanie kodu, `git diff`, uruchamianie testów/lint/tsc/build, parsowanie błędów, skan sekretów, pamięć doświadczeń.
  - **≤ 8 GB RAM / brak GPU (lub 4 GB VRAM):** jeśli Ollama jest dostępna — lekkie modele Q4 (`qwen2.5-coder:3b`, `qwen3:4b`) do lokalnych streszczeń, prostych poprawek i pracy offline; cięższe planowanie/kodowanie delegowane do puli `free_api`.
  - **16 GB RAM / 12–16 GB VRAM:** `qwen2.5-coder:7b` / `qwen2.5-coder:14b` / `gpt-oss:20b` jako główny darmowy `Developer`, darmowa chmura jako niezależny `Architect` / `Reviewer`.
  - **24 GB+ VRAM / 32 GB+ Unified RAM:** `qwen3-coder:30b` / `qwen2.5-coder:32b` lokalnie z pełnym tool-callingiem bez żadnych limitów dziennych!

---

## 4. Architektura docelowa Jarvis Forge

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  UI: src/components/ForgeWorkspace.tsx (<Modal>, 1 główne pole + 10 widoków)│
│  CLI: node forge/cli.mjs  │  Electron Auto-Start: electron/local-forge.cjs  │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ HTTP (127.0.0.1:3220 + token + X-Forge-Client) + SSE
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                      forge/server.mjs (Loopback Daemon)                     │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                  forge/engine.mjs (Autonomous State Machine)                │
│  SCOUTING → PLANNING → EXECUTING → VERIFYING → DEBUGGING/PIVOT → REVIEWING  │
│  • Event-Sourced Checkpoints (.jarvis-forge/runs/<id>.json + events.jsonl)  │
│  • Context Condenser (adaptacja do okna modelu)                             │
│  • Verify-Before-Success Gate (0 fałszywych sukcesów)                       │
│  • Strategy Pivot Engine (anti-loop + eskalacja modelu + rollback)          │
└───────────┬──────────────────────────┬──────────────────────────┬───────────┘
            │                          │                          │
┌───────────▼───────────┐  ┌───────────▼───────────┐  ┌───────────▼───────────┐
│ forge/repo-intel.mjs  │  │  forge/providers.mjs  │  │   forge/memory.mjs    │
│ • Skaner + .gitignore │  │ • 14 dostawców (plug) │  │ • Architektura & ADR  │
│ • Graf symboli/deps   │  │ • local/free/credit/  │  │ • Błąd → Zweryfik.    │
│ • Repo Map (PageRank) │  │   paid (0 USD domyśl.)│  │   rozwiązanie (Q/util)│
│ • Auto-detekcja testów│  │ • Hardware Profiler   │  │ • Nieudane próby      │
│ • forge/workspace.mjs │  │ • Router Ról uczący   │  │ • Skuteczność modeli  │
│   (ACI, SEARCH/REPLACE│  │   się z Memory        │  │ • Integracja z        │
│   syntax-check, diff, │  │ • Retry-After +       │  │   project-memory/     │
│   rollback, secrets)  │  │   cross-model review  │  │                       │
└───────────────────────┘  └───────────────────────┘  └───────────────────────┘
```

### Pięć uzasadnionych, mierzalnych ról (zamiast nadmiarowych 9 agentów)
1. **`Scout & Architect`** — deterministyczna mapa repo + analiza projektu i zwięzły, weryfikowalny plan kroków z wyborem komend testowych.
2. **`Developer`** — iteracyjna pętla narzędzi ACI (`read_file`, `search_code`, `repo_map`, `edit_file`, `write_file`, `run_command`) do implementacji zmian wieloplikowych.
3. **`Verifier` (0 tokenów LLM)** — twarda, deterministyczna egzekucja komend testowych/lint/typecheck/build z parsowaniem sygnatur błędów i realnym `git diff`.
4. **`Debugger & Strategist`** — uruchamiany wyłącznie przy porażce testu; korzysta z pamięci doświadczeń i nieudanych prób; przy powtarzającym się błędzie wymusza zmianę strategii (`strategy_pivot`) i rotację na inny model.
5. **`Reviewer`** — skan sekretów + analiza diffu + niezależny przegląd preferujący **innego dostawcę/model** niż `Developer`, zanim zadanie dostanie status `COMPLETED`.
