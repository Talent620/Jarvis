# JARVIS — Audyt z perspektywy użytkownika (FAZA 1)

> Read-only. Patrzę na projekt jak świadomy użytkownik-solopreneur: uruchamiam, klikam główne
> ścieżki, czytam kluczowe moduły. **Nie zmieniam kodu w tej fazie.** Kategorie: BŁĘDY / BRAKI UX /
> DŁUG TECHNICZNY / ŁATWE WYGRANE. Każda pozycja: **wpływ (1-5)** i **ryzyko naprawy (1-5)**.
> Skala: wpływ 5 = boli codziennie / traci dane; ryzyko 5 = duża zmiana, łatwo coś zepsuć.
>
> Audyt bezpieczeństwa/architektury (BFF, krypto, natywne powłoki) → **`AUDIT-SECURITY.md`**
> (zachowany osobno). Tu skupiam się na tym, co użytkownik CZUJE podczas pracy z apką.
>
> Baseline: HEAD `b982d9d`, testy zielone (2996), 4 bramki czyste. Znaleziska oparte na kodzie
> (podane `plik:linia`), nie na domysłach.

---

## BŁĘDY (rzeczy realnie zepsute)

| # | Znalezisko | Plik:linia | Wpływ | Ryzyko |
|---|---|---|---|---|
| ~~**B1**~~ | ~~Puste pola liczbowe zapisują `NaN`.~~ **NIEAKTUALNE (zweryfikowane w FAZA 2):** wskazane pola to `type="range"` (suwak nigdy nie jest pusty), a wszystkie pola `type="number"` z bezpośrednim `Number()` już mają guard (`\|\| undefined`/`\|\| 0`/`\|\| 465`, helper `numOrUndef`); dodatkowo `Number("")` === `0` (nie `NaN`) i przeglądarka blokuje nie-cyfry. Brak realnego błędu. | `Settings.tsx:1607,1644,1732,1749` | — | — |
| ~~**B2**~~ | ~~Gmail 500 na polskich tematach (`b64` lokalne).~~ **NIEAKTUALNE (zweryfikowane):** `b64` JEST moduł-globalne (`worker.js:39`, komentarz „używane też poza smtpRelay (np. /v1/gmail/send)"); ścieżka Gmaila (`worker.js:613`) widzi je bez `ReferenceError`. Naprawione we wcześniejszej rundzie. | `proxy/worker.js:39,613` | — | — |
| ~~**B3**~~ | ~~Import kopii nadpisuje ustawienia bez walidacji.~~ **NIEAKTUALNE (zweryfikowane):** `backup.ts` ma `ENDPOINT_KEYS` (L62) i `applyParsed(confirmEndpoints: (keys) => boolean)` (L71) — potwierdzenie użytkownika przy zmianie pól-endpointów (proxyUrl/syncUrl/smtpHost…). Naprawione. | `src/lib/backup.ts:62,71` | — | — |
| ~~**B4**~~ | ~~Cichy data-loss przy zapełnionym localStorage.~~ **NIEAKTUALNE (zweryfikowane):** `write()` łapie `QuotaExceededError` (L224), głośny toast „Nowe zmiany NIE zapisują się!" (L230) + trwały sygnał baneru (L211) + obsługa trybu prywatnego (L239). Naprawione. | `src/lib/store.ts:211-239` | — | — |
| ~~**B5**~~ | ~~Wyciek węzłów audio przy premium-TTS.~~ **NIEAKTUALNE (zweryfikowane):** `playUrlWithLevel` (`voice.ts:221`) ma `cleanup()` odłączający `srcNode`/`fxOut`/`analyserNode` w `onended`/`onerror` (`voice.ts:229-241`). Naprawione. | `src/lib/voice.ts:221-241` | — | — |
| ~~**B6**~~ | ~~Web Speech restart-storm.~~ **NIEAKTUALNE (zweryfikowane):** klasa rozpoznawania ma anty-storm — licznik `restarts`, backoff `min(5000, 150·2^n)`, poddanie po 8 próbach, zerowanie przy produktywnej sesji (`voice.ts:801-886`). Naprawione. | `src/lib/voice.ts:801-886` | — | — |
| ~~**B7**~~ | ~~sales-os per-lead outreach omija limity.~~ **NIEAKTUALNE (zweryfikowane):** brama jest w route (`outreach/route.ts:~119-130`) — przed `draftAndSendForLead` sprawdza `autoSendEmails` ORAZ `emailsSentToday < dailyEmailCap`; inaczej `effectiveSend=false` i szkic idzie do kolejki akceptacji. Dokładnie jak flush. Naprawione (gate we właściwym miejscu — route, nie silnik). | `outreach/route.ts:119-130` | — | — |

---

## BRAKI UX (działa, ale frustuje / gubi użytkownika)

| # | Znalezisko | Gdzie | Wpływ | Ryzyko |
|---|---|---|---|---|
| ~~**U1**~~ | ~~Kanban martwy na dotyku.~~ **CZĘŚCIOWE / ODRZUCONE (zweryfikowane):** HTML5 drag faktycznie nie działa na dotyku, ALE istnieje działająca, odkrywalna droga dotykowa — tap karty → Panel Klienta → chipy etapów (`ClientPanel.tsx:81-82`), świadomie „jedno miejsce sterowania statusem" (komentarz `SalesBoard.tsx:17`). Menu „przenieś" na karcie tylko dublowałoby chipy. Zostawione. | `SalesBoard.tsx:74-75` | — | — |
| ✅ **U2** | ~~Usunięcie leada bez cofnięcia.~~ **ZROBIONE (E5, commit 394842e):** `del()` zachowuje confirm i dokłada 6-sekundowy toast „Cofnij" przywracający lead (silnik pure `leadDelete.ts` + test). | `SalesDashboard.tsx` | 3 | 2 |
| ✅ **U3** | ~~Surowe komunikaty błędów poczty.~~ **CZĘŚCIOWO ZROBIONE (commit fd0029a):** nowy `adviseSendError` — nieudana wysyłka oferty pokazuje ludzką radę pod POCZTĘ (hasło aplikacji/timeout/backend/5xx), nie surowe `r.error`. Reszta ścieżek poczty już miała czytelne komunikaty (mailer `sendReady`). | `SalesDashboard.tsx` + `errorAdvisor.ts` | 3 | 2 |
| ~~**U4**~~ | ~~Małe cele dotykowe (<44px).~~ **PILNOWANE (zweryfikowane):** strażnik `tests/touchTargets.test.ts` (78 sprawdzeń, zielony) zakazuje `minHeight 32/40` na krytycznych ekranach. Kontrakt egzekwowany; ewentualny szerszy „a11y sweep" — do decyzji. | test `touchTargets` | — | — |
| **U5** | **Brak aria-label na części akcji-ikon.** Przyciski tylko-emoji nie mają etykiety → czytnik ekranu mówi „przycisk". *Niska wartość dla solo-operatora (główny użytkownik = właściciel); do decyzji jako osobny a11y sweep.* | ikony akcji | 2 | 1 |
| ~~**U6**~~ | ~~Prognoza ważona schowana.~~ **NIEAKTUALNE (zweryfikowane):** kokpit `SalesCockpit.tsx:32` pokazuje „🎯 prognoza" = `expected` (prognoza ważona, dodane w CRM P1). | `SalesCockpit.tsx:32` | — | — |

---

## DŁUG TECHNICZNY (nie boli dziś, ale spowalnia rozwój / grozi regresją)

| # | Znalezisko | Gdzie | Wpływ | Ryzyko |
|---|---|---|---|---|
| **D1** | **Brak strażnika „pułapki cudzysłowów".** Znak `„` (U+201E) + prosty `"` w literale TS wysadza esbuild — złapało nas ≥4× (psuło CI). Nie ma zautomatyzowanego lintera/pre-commita, który by to blokował. To najtańsza tarcza przeciw powtarzalnej regresji. | brak w `scripts/` | 4 | 1 |
| **D2** | **God-moduł `Settings.tsx` — 3190 linii.** Jeden plik trzyma wszystkie zakładki ustawień; każda zmiana ryzykuje kolizje, trudno testować, łatwo o pułapkę cudzysłowów. | `src/components/Settings.tsx` | 3 | 3 |
| **D3** | **God-moduł `tools.ts` — 1967 linii.** Rejestr narzędzi + logika w jednym pliku; `brain.ts` 996, `voice.ts` 910 — duże, słabo pokryte testami jednostkowymi. | `src/lib/tools.ts` i in. | 3 | 3 |
| **D4** | **Nakładające się `setInterval`.** 5 pętli w `App.tsx` tyka niezależnie od tego, czy funkcja włączona; async może się nakładać (część już ma guardy, nie wszystkie). | `App.tsx:294,580,608,632,653` | 3 | 3 |
| **D5** | **Częściowa adopcja bezpiecznego JSON (`lsJson`).** Część miejsc czyta localStorage surowo bez try/catch — uszkodzony wpis wywala parsowanie. | rozproszone | 2 | 2 |
| **D6** | **Globalny stan modułu w `brain.ts`.** `deepAnalysis`/`currentKnowledge`/`journalRank` — przeciek kontekstu między równoległymi `askJarvis`. | `src/lib/brain.ts` | 3 | 3 |

---

## ŁATWE WYGRANE (mały nakład, wyraźna poprawa — rekomendowany start FAZA 2)

| # | Znalezisko | Co zrobić | Wpływ | Ryzyko |
|---|---|---|---|---|
| ✅ **E1** | ~~Strażnik pułapki cudzysłowów.~~ **ZROBIONE (commit 1b45293):** detektor przez parser TS w `tests/quoteGuard.test.ts` (nie w `src/` — bez wciągania `typescript` do bundla), skan całego `src/**` w bramce vitest/CI, zero false-positives. Już złapał realną pułapkę w changelogu podczas E5. | `tests/quoteGuard.test.ts` | 4 | 1 |
| ~~**E2**~~ | ~~Guard `NaN` w polach liczbowych.~~ **ODRZUCONE** — B1 zweryfikowane jako nieaktualne (suwaki + istniejące guardy + `Number("")===0`). Brak zmiany. | `Settings.tsx` (B1) | — | — |
| ~~**E3**~~ | ~~`b64` globalny w workerze.~~ **NIEAKTUALNE** — B2 już naprawione (`b64` moduł-globalne, `worker.js:39`). | `worker.js` (B2) | — | — |
| ~~**E4**~~ | ~~Odłączanie węzłów audio.~~ **NIEAKTUALNE** — B5 już naprawione (`cleanup()` w `voice.ts:229-241`). | `voice.ts` (B5) | — | — |
| ✅ **E5** | ~~„Cofnij" po usunięciu leada.~~ **ZROBIONE (commit 394842e):** silnik pure `leadDelete.ts` + 6-sekundowy toast „Cofnij" w `SalesDashboard.del()`. | Sales (U2) | 3 | 2 |
| ~~**E6**~~ | ~~Dotykowy fallback kanbana.~~ **ODRZUCONE** — istnieje działająca droga dotykowa (tap karty → chipy etapów w Panelu Klienta); menu na karcie tylko dublowałoby jedyny punkt sterowania statusem. | `SalesBoard.tsx` (U1) | — | — |
| ~~**E7**~~ | ~~Backoff w Web Speech restart.~~ **NIEAKTUALNE** — B6 już naprawione (anty-storm + backoff w `voice.ts:801-886`). | `voice.ts` (B6) | — | — |

---

## POZA ZAKRESEM — tylko propozycja (NIE ruszam bez wyraźnej zgody)

- **Wyciek klucza OpenRouter w README** (`README.md:3-4`) — README samo ostrzega, że klucz `sk-or-v1-…`
  wyciekł w buildach ≤55 (był wpiekany do bundla). To **sekret** → zgodnie z twardą zasadą NIE dotykam
  konfiguracji/sekretów. **Propozycja:** zrotuj klucz ręcznie na openrouter.ai/keys (tego nie cofnie
  żaden commit). Mogę osobno dodać do `scan:secrets` regułę wykrywającą `sk-or-` w bundlu, żeby to się
  nie powtórzyło — ale sam klucz musisz zrotować Ty.
- **Sekcja „DO MOJEJ DECYZJI"** z `AUDIT-SECURITY.md` (BFF auth/SSRF, `admin.ts` krypto na numerze
  telefonu, `permissions.ts` fail-open, keystore w repo, self-signed EXE) — ryzykowne / mogą zerwać
  działające wdrożenie → zostają dla Twojej decyzji.

---

## Postęp FAZA 2 (autonomiczny — za zgodą użytkownika „lec dalej")

**Zrobione:** ✅ E1 (strażnik pułapki cudzysłowów, commit 1b45293) · ✅ E5 (Cofnij po usunięciu leada,
commit 394842e).
**Zweryfikowane jako nieaktualne** (naprawione we wcześniejszych rundach, potwierdzone w kodzie):
B1/E2 (NaN), B2/E3 (Gmail b64), B5/E4 (węzły audio), B6/E7 (Web Speech). **Odrzucone jako zbędne:**
U1/E6 (kanban ma działającą drogę dotykową).

> **Wniosek uczciwościowy:** większość „łatwych wygranych" była już naprawiona — moje UX-znaleziska
> opierały się na znacznikach „✅ do naprawy" z audytu bezpieczeństwa, a te naprawy zdążyły wejść.
> Zweryfikowałem każde na żywym kodzie ZANIM cokolwiek zmieniłem (zamiast wymyślać poprawki „na siłę").

**BŁĘDY B3/B4/B7 — zweryfikowane jako JUŻ NAPRAWIONE** (walidacja importu kopii: `backup.ts:62,71`;
głośna quota: `store.ts:211-239`; gate limitów sales-os: `outreach/route.ts:119-130`). Potwierdzone w kodzie.

---

## Podsumowanie FAZA 2 (uczciwe, domknięte)

**Zrobione realnie — 3 poprawki** (każda: silnik pure + test + 4 bramki + push + CI):
- ✅ **E1** — strażnik pułapki cudzysłowów (commit 1b45293)
- ✅ **E5** — „Cofnij" po usunięciu leada (commit 394842e)
- ✅ **U3** — czytelny błąd nieudanej wysyłki oferty (`adviseSendError`, commit fd0029a)

**Zweryfikowane jako już naprawione / już obecne** (potwierdzone w kodzie, zero „napraw na siłę"):
B1/E2 (NaN — suwaki), B2/E3 (Gmail b64), B3 (walidacja importu), B4 (głośna quota), B5/E4 (węzły audio),
B6/E7 (Web Speech), B7 (limity sales-os), U2 (Cofnij — to E5), U4 (tap-targety — strażnik zielony),
U6 (prognoza ważona w kokpicie). **Odrzucone jako zbędne:** U1/E6 (kanban ma drogę dotykową).

**Dlaczego tak mało NOWEGO kodu = DOBRY wynik:** mój UX-audyt opierał się na znacznikach „✅ do naprawy"
z `AUDIT-SECURITY.md`, a te naprawy zdążyły wejść zanim spisałem znaleziska. Każde zweryfikowałem na
żywym kodzie ZANIM cokolwiek zmieniłem. Kod jest w bardzo dobrej kondycji: **3014 testów, 4 bramki czyste.**

**Co ZOSTAJE dla Twojej decyzji (świadomie NIE ruszam autonomicznie):**
- **DŁUG D2/D3** — rozbicie god-modułów `Settings.tsx` (3190 l.), `tools.ts` (1967 l.): duży refaktor,
  ryzyko regresji; sensowne tylko wycinkami, za Twoją zgodą.
- **U5 (a11y sweep)** — aria-label na ikonach: niska wartość dla solo-operatora, wiele plików w jednym ruchu.
- **POZA ZAKRESEM**: rotacja klucza OpenRouter (tylko Ty), pozycje „DO MOJEJ DECYZJI" z `AUDIT-SECURITY.md`
  (BFF auth/SSRF, `admin.ts`, keystore, self-signed EXE) — ryzykowne / mogą zerwać wdrożenie.

**Bezpieczna część FAZY 2 jest wyczerpana** — dalej wchodzą już rzeczy ryzykowne albo niskiej wartości,
więc zgodnie z Twoją zasadą („zatrzymaj się, gdy wyczerpiesz listę zatwierdzonych zadań") oddaję Ci ster.
Wskaż numer (np. „D2", „U5") jeśli chcesz, żebym wszedł w któreś z powyższych.
