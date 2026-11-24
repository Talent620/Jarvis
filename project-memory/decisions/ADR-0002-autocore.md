# ADR-0002: JARVIS AUTOCORE — centralne zarządzanie AI, budżetem i nadzorem

- **Status:** accepted
- **Data:** 2026-11-24
- **Autor:** antigravity
- **Zakres:** `src/lib/autocore/*`, `src/components/AutoCorePanel.tsx`, `proxy/lib/providers.js`, `scripts/agent-lock.mjs`, `scripts/guardian-daemon.mjs`, `scripts/verify-apk.mjs`, `AGENTS.md`

## Kontekst
Wcześniej lista dostawców, modele per zadanie, reguły wizji, darmowe tiery, cennik oraz stan błędów były rozproszone między `brain.ts`, `modelRouter.ts`, `freeMode.ts`, `brainAdvisor.ts`, `usageTelemetry.ts`, `providers/registry.ts` oraz bezpośrednie wywołania (`council.ts`, `localResearchAgent.ts`, `transcribe.ts`, `Onboarding.tsx`). Dodatkowo `proxy/lib/providers.js` odrzucał `api.cerebras.ai` i `api.mistral.ai` kodem 403 przy włączonym `proxyUrl`.

## Decyzja
1. **Warstwa `src/lib/autocore/` wokół istniejącego `registry.ts` i `brain.ts`** (bez przepisywania od zera i bez utraty istniejących funkcji):
   - `catalog.ts`: jedno źródło profili dostawców (`PROFILES`), klas kosztu (`local`/`free`/`freemium`/`credit`/`paid`/`unknown`), modeli per zadanie i cennika; moduły zależne wyprowadzają z niego swoje zbiory (leniwe gettery w `brain.ts` unikają TDZ z cyklu `providers↔tools↔brain`).
   - `health.ts`: trwały stan zdrowia kluczy (po 32-bitowym odcisku FNV-1a, bez sekretów), modeli i dostawców (401/403 do zmiany klucza, 402 na 24 h, 429 wg `Retry-After`/backoff, 404 model_missing, 400 capability mismatch).
   - `budget.ts`: jeden miesięczny limit (`aiMonthlyBudgetUsd`) + limit dzienny, twarda blokada płatnych operacji po wyczerpaniu, zasada *grandfathering* (istniejące klucze działają bez regresji; nowo podłączone usługi mogące być płatne wymagają zatwierdzenia limitu).
   - `router.ts`: klasy zadań A–J, ranking z linią bazową równą dotychczasowej randze (gdy brak pomiarów), dziennik zmian routingu oraz automatyczny rollback po serii porażek po promocji.
   - `gateway.ts`: wspólny kontrakt `aiRequest` + `resolveService` + `reportOutcome`.
   - `discovery.ts`: bezdestrukcyjne scalanie kluczy (`mergeProviderKey`), weryfikacja przez oficjalne `/models` (sama lista nie oznacza jeszcze weryfikacji generacji), brak automatycznego wybudzania GPU Modal.
   - `experiments.ts`: deterministyczne mikro-testy po polsku (domyślnie tylko `local`/`free`), promocja z progiem przewagi i ochroną niezawodności.
2. **Jeden ekran `AutoCorePanel.tsx`** na górze Ustawień → AI; zaawansowane sekcje techniczne zwinięte w `Diagnostyka zaawansowana`.
3. **Współbieżność i nadzór bez GitHub Actions:** `scripts/agent-lock.mjs` (atomowa blokada git ref `refs/heads/lock/<task>`) oraz `scripts/guardian-daemon.mjs` + jednostki `systemd` (`deploy/systemd/`).

## Konsekwencje
- Wszystkie moduły czatu, konsylium, agenta lokalnego i STT korzystają ze wspólnej kontroli zdrowia i budżetu.
- Zmiany bezpieczeństwa wymagające zgody właściciela (np. `android:allowBackup`) nie zostały zmienione automatycznie — wymagają jawnej decyzji.
- Analiza dokumentacji dostawców i testy UI w przeglądarce (Playwright) nie są zaimplementowane — oznaczone jako `UNKNOWN`/brak w raporcie.
