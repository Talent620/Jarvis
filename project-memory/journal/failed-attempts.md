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

