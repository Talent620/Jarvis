# 🔐 Bezpieczeństwo JARVIS

> ## 🚨 PILNE — ZROTUJ KLUCZ OPENROUTER
> **Klucz OpenRouter `sk-or-v1-…` wyciekł w buildach APK ≤ 55** (był wpiekany do bundla
> klienta przez `__DEFAULT_KEYS__`). Każdy, kto pobrał i zdekompilował APK, mógł go odczytać.
>
> **MUSISZ zrobić ręcznie — tego NIE da się cofnąć z poziomu kodu:**
> 1. Wejdź na **https://openrouter.ai/keys**, **usuń/zrotuj** wyciekły klucz `sk-or-v1-…`.
> 2. Sprawdź zużycie/rozliczenia pod kątem nadużyć.
> 3. Tak samo **zrotuj profilaktycznie** pozostałe klucze, które kiedykolwiek były w Secrets
>    builda i mogły trafić do bundla: **Gemini (`AIza…`), Groq (`gsk_…`), Anthropic (`sk-ant-…`),
>    NVIDIA, Mistral, Cerebras, GitHub Models, Tavily.**
> 4. Nowe klucze ustaw **wyłącznie jako sekrety BFF** (`wrangler secret put …`) — nigdy w bundlu.

---

## Model zagrożeń i zasada

- **Żaden klucz API nie może trafić do bundla klienta ani na urządzenie.** Build wstrzykuje
  `__DEFAULT_KEYS__` jako **pusty** obiekt (`vite.config.ts`).
- **Wbudowane (darmowe) modele** działają przez **BFF** (Cloudflare Worker, katalog `proxy/`),
  który dokleja klucze z sekretów po stronie serwera. Adres BFF podajesz w `VITE_BFF_URL`.
- **Tryb „własny klucz" (BYOK):** użytkownik może wpisać własny klucz — trzymany lokalnie
  (localStorage), opcjonalnie za blokadą PIN/sejfem. Nie jest wysyłany nigdzie poza dostawcę
  (lub BFF w trybie passthrough).

## Skan sekretów (pre-commit)

W repo jest hook blokujący commit z sekretami (`sk-or-`, `sk-ant-`, `AIza…`, `gsk_…`, `Bearer …`).
Włącz go raz po sklonowaniu:

```bash
git config core.hooksPath .githooks
# albo: npm run hooks
```

Ręczny skan całego repo: `npm run scan:secrets`.

## Lista kontrolna utwardzenia — DO WYKONANIA PRZEZ WŁAŚCICIELA

Te pozycje wymagają Twojej decyzji/operacji (kod ich nie zrobi sam — mogą zerwać wdrożenie
albo są nieodwracalne). Audyt: `AUDIT.md §9`. Status kodu po stronie aplikacji: **już gotowy**,
brakuje tylko Twojego kroku po stronie infrastruktury.

- [ ] **BFF `APP_TOKEN` (najważniejsze).** Ustaw sekret, by zablokować anonimowe wydawanie Twoich
      kluczy AI: `wrangler secret put APP_TOKEN` (w katalogu `proxy/`). Klient już wysyła
      `x-app-token` (build z `VITE_APP_TOKEN`). Po ustawieniu trasy `/anthropic /openai /gemini
      /passthrough /v1/search /v1/embed` egzekwują token. **Bez tego worker jest otwarty.**
- [ ] **Rate-limit BFF.** Ustaw `RATE_LIMIT_PER_MIN` (np. `60`) + binding `JARVIS_KV` — anty-abuse.
- [ ] **Rotacja kluczy podpisujących Android.** `android/keystore/jarvis.jks` + hasła były w repo.
      Wygeneruj NOWY keystore, trzymaj poza repo, podaj jako sekrety CI (`JARVIS_RELEASE_*` — kod
      `build.gradle` już je czyta). ⚠️ Nieodwracalne wobec Sklepu Play (apka ze starym podpisem nie
      zaktualizuje się nowym kluczem) — rób świadomie.
- [ ] **`license-private.json`** (klucz ECDSA licencji) — przenieś poza katalog projektu do
      bezpiecznego magazynu; nigdy nie commituj.
- [ ] **(opcjonalnie) Wydania tylko z tagów.** Dziś `release.yml` publikuje `latest` na każdy push
      brancha (wygodne, ale bez bramki review). Jeśli chcesz kontroli — ogranicz trigger do `v*`.
- [ ] **Panel admina / `admin.ts`.** Sekret administratora jest pochodną numeru telefonu (niska
      entropia). Docelowo: osobny, wysokoentropijny sekret — wymaga zmiany logowania właściciela.

## Zgłaszanie podatności

Znalazłeś problem bezpieczeństwa? Nie otwieraj publicznego issue — skontaktuj się z autorem
bezpośrednio. Dziękujemy za odpowiedzialne ujawnienie.
