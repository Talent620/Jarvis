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
| **B1** | **Puste pola liczbowe zapisują `NaN` do ustawień.** `Number(e.target.value)` bez fallbacku — skasowanie zawartości pola „Ollama num_predict / num_ctx / num_gpu" i progu pewności wpisuje `NaN`, co potem leci do modelu/logiki i psuje zachowanie po cichu. | `Settings.tsx:1607,1644,1732,1749` | 3 | 1 |
| **B2** | **Gmail 500 na polskich tematach.** `worker.js` woła `b64(...)`, ale `b64` jest zdefiniowane tylko lokalnie w `smtpRelay`; w zasięgu modułu jest `b64url`. Temat z polskimi znakami → `ReferenceError` → 500 połknięty przez catch. Apka jest PL-first → realnie łamie wysyłkę. | `proxy/worker.js:467-468` | 4 | 1 |
| **B3** | **Import kopii zapasowej nadpisuje ustawienia bez walidacji.** `applyParsed` robi `setSettings(parsed.settings)` — spreparowany plik może wstrzyknąć `proxyUrl`/`syncUrl`/`smtpHost` i przekierować cały ruch AI + pocztę. `looksLikeBackup` sprawdza tylko tablice danych. | `src/lib/backup.ts:36-39` | 4 | 2 |
| **B4** | **Cichy data-loss przy zapełnionym localStorage.** `setData` zmienia RAM i `emit()`, ale gdy `write()` przekroczy quota — zapis do localStorage nie przechodzi, a UI pokazuje „zapisane". Zmiany giną po restarcie. | `src/lib/store.ts:118-130` | 4 | 2 |
| **B5** | **Wyciek węzłów audio przy premium-TTS.** `playUrlWithLevel` (Fish/ElevenLabs) tworzy `MediaElementAudioSourceNode`+`AnalyserNode` na współdzielonym `levelCtx` i nigdy ich nie odłącza. Akumulacja + CPU w wątku audio przez całą sesję. | `src/lib/voice.ts:65-98` | 3 | 1 |
| **B6** | **Web Speech restart-storm.** `onend→start()` bez backoffu — przy utracie mic/sieci pętli się w kółko; `onerror` to no-op. Rozgrzewa CPU/baterię i blokuje mikrofon. | `src/lib/voice.ts:525-541` | 3 | 1 |
| **B7** | **sales-os per-lead outreach omija limity.** Ścieżka per-lead wysyła od razu (Resend/Mailgun) bez sprawdzenia `autoSendEmails` ani `dailyEmailCap` (flush je honoruje). Token-holder może wysłać nieograniczoną pocztę. | `sales-os/.../public-outreach.ts:125-171` | 4 | 1 |

---

## BRAKI UX (działa, ale frustuje / gubi użytkownika)

| # | Znalezisko | Gdzie | Wpływ | Ryzyko |
|---|---|---|---|---|
| **U1** | **Kanban lejka martwy na dotyku.** Tablica używa HTML5 `draggable`/`onDragStart` — na telefonie (Galaxy S9, główny cel) przeciąganie kart nie działa wcale; brak `onTouchStart`/fallbacku „przenieś do…". Na mobile nie zmienisz etapu przez kanban. | `SalesBoard.tsx:74-75` | 4 | 3 |
| **U2** | **Usunięcie leada bez cofnięcia.** Po `window.confirm` lead znika bezpowrotnie (razem z ofertą). Pomyłkowe „OK" = utrata kontaktu, brak „Cofnij". | `SalesDashboard.tsx:301` | 3 | 2 |
| **U3** | **Surowe komunikaty błędów poczty/API.** Część błędów pokazuje techniczny tekst dostawcy zamiast „co się stało + krok po kroku jak naprawić" (część ścieżek już ma advisor, ale nie wszystkie). | poczta/API w Settings/Sales | 3 | 2 |
| **U4** | **Małe cele dotykowe (<44px).** Część guzików/ikon w gęstych panelach jest poniżej rekomendowanych 44×44px — trudne trafienie kciukiem na telefonie. | panele gęste (Sales/Settings) | 3 | 2 |
| **U5** | **Brak aria-label na części akcji-ikon.** Przyciski bez tekstu (tylko emoji/ikona) nie mają etykiety → gorsza dostępność i czytnik ekranu mówi „przycisk". | ikony akcji w komponentach | 2 | 1 |
| **U6** | **Prognoza ważona schowana.** `pipelineForecast` liczy expected value, ale pokazujemy ją tylko w pod-panelu Plan, nie w kokpicie Sprzedaży — użytkownik nie widzi „ile realnie wpłynie". | `SalesPlan` vs kokpit | 3 | 2 |

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
| **E1** | **Strażnik pułapki cudzysłowów.** Dodać pure-funkcję `scanQuoteTrap()` + test + wpiąć w `scan:secrets`/pre-commit. Blokuje najczęstszą regresję CI raz na zawsze. | nowy `src/lib/quoteGuard.ts` + test | 4 | 1 |
| **E2** | **Guard `NaN` w polach liczbowych.** Dodać fallback (`|| domyślna`) do 4 pól Ollama/progu. Czysta, lokalna zmiana. | `Settings.tsx` (B1) | 3 | 1 |
| **E3** | **`b64` globalny w workerze.** Wynieść `b64` do zasięgu modułu → naprawia Gmail 500 na PL tematach. | `worker.js` (B2) | 4 | 1 |
| **E4** | **Odłączanie węzłów audio.** Odłączać w `onended`/error (lub kierować przez `playUrlEnded`). | `voice.ts` (B5) | 3 | 1 |
| **E5** | **„Cofnij" po usunięciu leada.** Trzymać ostatnio usunięty lead ~6s + toast „Cofnij". | Sales (U2) | 3 | 2 |
| **E6** | **Dotykowy fallback kanbana.** Dodać na karcie menu „Przenieś do etapu →" (działa na dotyku), obok istniejącego drag na desktopie. | `SalesBoard.tsx` (U1) | 4 | 2 |
| **E7** | **Backoff w Web Speech restart.** Dodać rosnący odstęp + limit prób przy `onend/onerror`. | `voice.ts` (B6) | 3 | 1 |

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

## Rekomendowana kolejność FAZA 2 (bezpieczne najpierw)

**E1 → E2 → E3 → E4 → E7 → E5 → E6**, potem B3/B4/B7 (walidacja importu, głośna quota, gate limitów
sales-os). Każde = osobny commit + test + 4 bramki (tsc/eslint/vitest/build) + push + CI. Nic z sekcji
„POZA ZAKRESEM" bez Twojego wyraźnego „tak".

*Nie wprowadzam żadnych zmian w tej fazie. Wskaż numery (np. „E1, E2, E5") lub napisz „wszystkie łatwe
wygrane", a ruszam FAZA 2 — jedno zadanie na raz.*
