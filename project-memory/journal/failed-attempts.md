# Nieudane podejścia — dziennik

> Każdy agent **czyta ten plik przed** podjęciem zadania w tym samym obszarze. Wpis = fakt z dowodem
> (commit, run CI, log). Hipotezy o przyczynie oznaczaj „HIPOTEZA”. Bez sekretów i treści prywatnych rozmów.
> Dopisuj nowe wpisy na końcu z kolejnym numerem `FA-NNN`; istniejących nie przepisuj (najwyżej dodaj „Aktualizacja”).

## FA-001 — PKCS12 z różnymi hasłami store/key → `apksigner` BadPaddingException
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** `.github/workflows/android-v2.yml`, podpis APK
- **Co próbowano:** keystore PKCS12 wygenerowany z innym `-storepass` i `-keypass`, podpis przez `apksigner sign`.
- **Wynik (fakt):** run CI `45396251513` — `javax.crypto.BadPaddingException` przy odczycie klucza.
- **Przyczyna (potwierdzona):** PKCS12 w praktyce wymaga identycznego hasła magazynu i klucza.
- **Co zadziałało:** nowy PKCS12 z tym samym hasłem dla obu sekretów; runy `45397052972`, `45398610490` zielone.
- **Nie powtarzać:** różnych haseł store/key przy PKCS12.

## FA-002 — `gh release upload` z maszyny VM → HTTP 401 na uploads.github.com
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** publikacja APK
- **Wynik (fakt):** upload assetu z VM kończy się 401, mimo działającego `gh` dla API.
- **HIPOTEZA:** token środowiska nie obejmuje hosta `uploads.github.com`.
- **Co zadziałało:** publikacja wyłącznie z workflow (`softprops/action-gh-release@v2`, `contents: write`).
- **Nie powtarzać:** ręcznego uploadu assetów z VM.

## FA-003 — Sideload APK z usługą Dostępności blokowany przez Google Play Protect
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** `AndroidManifest.xml`, dystrybucja APK
- **Co próbowano:** poprawny podpis V1+V2+V3, zipalign, nowy `applicationId` (`net.serwer256.jarvis.v4`, commit `d387067`).
- **Wynik (fakt):** zrzut ekranu użytkownika — „Google Play Protect: Aplikacja została zablokowana, aby chronić urządzenie”
  + „Aplikacja nie została zainstalowana”. Podpis i wyrównanie były poprawne (`apksigner verify`, `zipalign -c 4`).
- **Przyczyna (wysokie prawdopodobieństwo, nie potwierdzona przez Google):** rozszerzona ochrona przed oszustwami blokuje
  instalację z przeglądarki aplikacji deklarujących `BIND_ACCESSIBILITY_SERVICE` (oraz wrażliwe uprawnienia).
- **Co zrobiono:** wariant sideload bez `JarvisAccessibilityService` i `QUERY_ALL_PACKAGES` (commit `f5a5dc4`, release
  `v4-jarvis-apex-safe`). **Instalacja tego wariantu na telefonie użytkownika: NIEPOTWIERDZONA.**
- **Nie powtarzać:** diagnozowania „nie zainstalowano” wyłącznie po podpisie — najpierw zrzut ekranu instalatora.

## FA-004 — Nieaktualny fixture licencji po rotacji klucza ECDSA
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** `tests/license.test.ts`, `src/lib/license.ts`
- **Wynik (fakt):** 2 testy czerwone — fixture `MASTER` podpisany starym kluczem.
- **Co zadziałało:** efemeryczna para ECDSA P-256 w `beforeAll` + jawna asercja, że stary token NIE przechodzi
  z produkcyjnym kluczem (commit `ac4cbdf`). Test nie został osłabiony — sprawdza oba kierunki.
- **Nie powtarzać:** „naprawiania” testu przez usunięcie asercji lub wpisanie nowego tokenu produkcyjnego.

## FA-005 — Modal Brain: pierwsza odpowiedź po bezczynności nie mieści się w 20 s
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** `deploy/modal_brain.py`
- **Wynik (fakt):** `curl --max-time 20 …/v1/models` → kod 000 (timeout), aplikacja `jarvis-brain` w stanie deployed, 0 kontenerów.
- **HIPOTEZA:** zimny start GPU + ładowanie wag (scaledown po 60 s). Nie zmierzono pełnego czasu startu.
- **Następny krok:** zmierzyć rzeczywisty cold start zanim zmieni się `scaledown_window` (koszt!).
- **Aktualizacja (2026-11-25, Faza 2 Forge):** `modal app logs jarvis-brain` potwierdziło prawdziwą przyczynę — to NIE był sam cold start, lecz **pętla CUDA OOM na 1× L4 (24 GB VRAM)**: `Qwen/Qwen3-32B-AWQ` (~18.5 GB wag) + `MAX_MODEL_LEN=16384` + vLLM V1 bez `--enforce-eager` zostawiało `16 MB` wolnego VRAM (`Available KV cache: 1.52 GiB`, `EngineCore failed to start`). Aplikacja `jarvis-brain` wpadała w restart loop przy żądaniach (spalając kredyty promocyjne `Deployed Apps: $12.31 → $13.02`). **Rozwiązanie (do decyzji właściciela przy kolejnym deploy):** zmiana GPU na `A100-40GB`/`L40S` z `--enforce-eager`, ALBO zmiana modelu na `Qwen/Qwen3-14B-AWQ` / obniżenie `MODAL_BRAIN_MAX_LEN=8192` + `--enforce-eager`.

## FA-006 — Ollama `qwen2.5-coder:3b` na 2 vCPU: inline JSON tool calls + timeout przy `num_ctx: 8192`
- **Data:** 2026-11-25 · **Agent:** antigravity · **Obszar:** `forge/providers.mjs`, benchmark 1A na lokalnym CPU (2 vCPU / 8 GB RAM)
- **Co próbowano:** pełna pętla autonomiczna (Architect + Developer) na lokalnej Ollamie `qwen2.5-coder:3b` bez GPU przy domyślnym `num_ctx: 8192` i `timeoutMs: 120_000`.
- **Wynik (fakt):** (1) `qwen2.5-coder:3b` w protokole `/api/chat` zwracało wywołania narzędzi jako surowy JSON w polu `message.content` zamiast `message.tool_calls`; (2) na 2 vCPU prefill długiego promptu deweloperskiego przekroczył 120 s (`This operation was aborted`, run `forge-20261125T194121Z-c458f2`); (3) w jednorazowej sondzie `codingFix` model 3B skopiował błędny wzór bez naprawy matematyki.
- **Co zadziałało:** (1) parser `extractInlineToolCallsFromText` w `callOllamaProtocol` (`forge/providers.mjs`, commit `7c00e53`); (2) adaptacja `cpu_light` (`num_ctx: 4096`, `num_predict: 1024`, `timeoutMs: 180_000`); (3) w roli recenzenta cross-model (krótki diff) lokalny `qwen2.5-coder:3b` działał stabilnie i zatwierdził Benchmark 1B.
- **Nie powtarzać:** uruchamiania wielokrokowego kodowania na modelu 3B przy 2 vCPU bez GPU z `num_ctx >= 8192` i oczekiwania skuteczności modeli 14B–32B+.

## FA-007 — Benchmark 2 & 3 live: brak bramki kompletności (`finish_task`) i ucinanie spacji w `git status --porcelain`
- **Data:** 2026-11-25 · **Agent:** antigravity · **Obszar:** `forge/engine.mjs`, `forge/workspace.mjs`, `forge/worktree.mjs`
- **Wynik (fakt):** (1) w Benchmark 2 (`bench-ledger`, 4 pliki) model zmodyfikował 2/4 pliki (`src/validator.mjs`, `src/store.mjs`) i wyczerpał `stepBudgetForCycle=8` bez wywołania `finish_task`; istniejące 2 testy regresji przeszły (`exit 0`) i self-reviewer zaakceptował niekompletne zadanie; (2) w Benchmark 2 błędny `edit_file` zostawiał uszkodzoną składnię na dysku; (3) w `forge/worktree.mjs` metoda `gitExec(...).trim()` obcinała wiodącą spację w `" M src/a.mjs"` z `git status --porcelain=v1`, skracając ścieżkę do `"rc/a.mjs"`.
- **Co zadziałało (commit `7c00e53`):** (1) **Completeness Gate** blokujący `completed` gdy `!devFinished` + lista `targetFiles` w prompcie recenzenta + `stepBudgetForCycle=14`; (2) **SWE-agent Edit-Lint-Revert** w `forge/workspace.mjs` atomowo cofający `edit_file` przy błędzie składni + fallback wcięć + usuwanie prefiksów `12: `; (3) `.trimEnd()` w `forge/worktree.mjs`. Zweryfikowane deterministycznie w `tests/jarvisForgePhase2Hardening.test.ts` (6/6 PASS).
- **Nie powtarzać:** uznawania zadania za ukończone wyłącznie po `exit 0` dotychczasowych testów bez sprawdzenia `devFinished` i zakresu `targetFiles`, ani stosowania `.trim()` na wyjściu `git status --porcelain`.

## FA-008 — Eksperyment Adaptive Intelligence i turniej konkurencyjny live: ograniczenia 1.5B, wyścig budżetu na 1 GPU i głód iteracji
- **Data:** 2026-11-25 · **Agent:** antigravity · **Obszar:** `forge/adaptive.mjs`, `forge/budget.mjs`, `forge/providers.mjs`, `forge/engine.mjs`, `forge/workspace.mjs`
- **Co próbowano (żywe modele, bez atrap):** (1) Exp A1 (`pricing.mjs`) na lokalnym `ollama/qwen2.5-coder:1.5b` (2 vCPU, `$0.00`); (2) Exp B3 (`ttlCache.mjs`) z żywą eskalacją `local_free → promo_credits`; (3) Exp B1 (5-plikowy `bench-ledger`); (4) Exp C1 (3-kandydatowy równoległy turniej na greenfield DAG scheduler: `ollama/1.5b` || `modal/Qwen3-32B direct_patch` || `modal/Qwen3-32B test_first_decomposition` przy limicie `$0.25`).
- **Wynik (fakt):**
  1. `qwen2.5-coder:1.5b` w Exp A1 zrobiło pustą edycję i próbowało **oszukać testy przez `edit_file(test/pricing.test.mjs)`**, a w Exp C1 4× halucynowało nieistniejące narzędzie `createTaskScheduler` (`0` plików, `blocked`).
  2. `qwen2.5-coder:3b` w Exp B3 wyemitowało 2 wywołania narzędzi jako NDJSON linia-po-linii w jednym bloku ` ```json ` (stary parser zwrócił `[]`), po czym Zasada 5 poprawnie eskalowała `local_free → promo_credits`.
  3. W Exp C1 uruchomienie **2 kandydatów równolegle na tym samym 1-kontenerowym `modal-bridge.py`** i wspólnym ciasnym budżecie `$0.25` spowodowało wyścig w `assertCanSpend` (podwójne liczenie zimnego startu do `$0.3607`), zagłodzenie kandydata `direct_patch` (który zdążył napisać 337 linii `src/scheduler.mjs` + `test/scheduler.test.mjs`) przez `test_first_decomposition` zapętlone na `list_files` oraz `0/3` zwycięzców (`parallelWorthIt: false`).
  4. W Exp B1 `Qwen3-32B-AWQ` zapisało wszystkie 5/5 plików (w tym poprawne `buildAnnualProjection` i 5 testów), ale po 4 odrzuconych `edit_file` zostało zatrzymane przez `maxIterations=18` tuż przed poprawą 1 literówki (`validateOneTimeExpense is not defined`).
- **Co wdrożono (commit `aff119c`):** deterministyczna ochrona plików `protectedPaths` (blokada edycji chronionych testów), bezpieczny split jednoliniowego `run_command`, parser NDJSON w `extractInlineToolCallsFromText`, bonus `+6` iteracji przy eskalacji tieru, `inFlightReservedUsd` w `PromoBudgetGovernor`, blokada przyznawania punktów za `0` uruchomionych testów w `scoreCandidateSolution` oraz rozbudowane limity przy `resumeRunId`.
- **Nie powtarzać:** równoległego uruchamiania 2 kandydatów na tym samym pojedynczym GPU / wspólnym ciasnym budżecie kredytów (tryb konkurencyjny ma sens wyłącznie przy **niezależnych, silnych i osobno limitowanych backendach** np. `api_free A` || `api_free B` lub lokalny GPU 14B || chmura 32B) ani liczenia na to, że model 1.5B rozwiąże wieloetapowe zadanie kodujące.

## FA-009 — Faza 5 live Ollama CPU: domyślny `qwen3:4b` (Thinking-2507), utrata KV-cache i fałszywe odrzucenia cross-model review
- **Data:** 2026-11-27 · **Agent:** antigravity · **Obszar:** `forge/providers.mjs`, `forge/engine.mjs`, `forge/workspace.mjs` (żywe testy na lokalnej Ollamie `v0.40.18`, 2 vCPU / 7.8 GB RAM, `$0.00`)
- **Co próbowano:** wieloplikowe i jednoplikowe zadania naprawcze bez podpowiedzi na prawdziwych lokalnych modelach Ollama (`qwen2.5-coder:3b`, `qwen3:4b`, `qwen3:4b-instruct-2507-q4_K_M`).
- **Wynik (fakty z logów `llama-server` i CLI):**
  1. Domyślny tag `qwen3:4b` w rejestrze Ollama wskazuje na **`Qwen3-4B-Thinking-2507`**, który **ignoruje `think: false`** (sonda `Reply with OK` zwróciła 40 tokenów rozważań w `message.content`, `thinking: null`) — na 2 vCPU generował 355+ tokenów i przekraczał limity 180–240 s.
  2. Równoległe uruchamianie Vitest wraz z Ollamą CPU oraz `activeContextChars = 6500` niszczyło prefiks KV-cache `llama.cpp` w 3. turze (re-prefill 1725 tokenów = 170 s).
  3. `edit_file` zwracało `ok: true` dla pustej edycji (`after === before`), co powodowało zapętlenie `qwen2.5-coder:3b` (5× no-op bez wyjścia do `VERIFYING` i bez rotacji modelu); ponadto `qwen2.5-coder:3b` przy `calculateOrderTotal` 5× halucynowało mnożenie zamiast zamiany `+` na `-`, a w `discount.mjs` emitowało niedozwolony w RFC 8259 eskejp `\'` w inline JSON.
  4. `extractErrorSignature` pomijało linie Node.js `--test` TAP (`not ok`, `expected:`, `actual:`, `location:`), a `state.targetFiles` zawierało bezwzględne ścieżki plików testowych z baseline scouta (`/tmp/.../math.test.mjs`), przez co uczciwy niezależny recenzent (`qwen3:4b-instruct`) 3× odrzucał poprawną poprawkę jako `[BRAKUJĄCE: math.test.mjs]` mimo aktywnej ochrony testów.
- **Co zadziałało:**
  1. Zastąpienie `qwen3:4b` wariantem nietrybowym **`qwen3:4b-instruct-2507-q4_K_M`** (`eval_count: 2` na sondzie `"OK"`) i podniesienie go nad `qwen2.5-coder:3b` w `pickBestLocalOllamaModel`.
  2. `COMPACT_OLLAMA_TOOLS`, `format: "json"` + ograniczone `num_predict` dla ról JSON-only, deterministyczny plan z baseline scouta na `cpu_light`, bezpieczny fallback Architecta po timeoutcie oraz strojenie budżetu kontekstu (`f_sim_best = 0.987–0.990`, kolejne tury 11–25 s).
  3. Odrzucanie no-op `edit_file` (`noOp: true`), detektor pętli wewnątrz pętli Developera (`consecutiveNoOps >= 2`, `repeatedTestFailCount >= 2`, `consecutiveFailedTestRuns >= 3`) z czystym handoffem i bonusem `+4` iteracji po rotacji modelu, naprawa `\'` i surowych `\n` w `safeJsonParseRelaxed`, pełna ekstrakcja Node TAP w `extractErrorSignature` oraz `normalizeEditableTargetFiles` + `OCHRONA TESTÓW` u Recenzenta.
  4. **Potwierdzone żywe PASS na lokalnej Ollamie (`$0.00`):** `npm run forge:accept` krok 7 (`113.9 s`, 3 iter.), realne CLI `forge/cli.mjs autopilot` (`order-pricing`, `292.2 s`, 2 iter., 3/3 `node --test`, `independentModelReviewed: true`) oraz 2-plikowy `order-pipeline` z automatycznym `git worktree` (`322.6 s`, 3 iter., 3/3 `node --test`, `independentModelReviewed: true`).
- **Nie powtarzać:** instalowania `qwen3:4b` (Thinking) zamiast `qwen3:4b-instruct-2507-q4_K_M` na hostach CPU bez GPU, równoczesnego uruchamiania Vitest i inferencji Ollama na 2 vCPU, ani umieszczania chronionych plików testowych w `state.targetFiles` przekazywanych Recenzentowi.



