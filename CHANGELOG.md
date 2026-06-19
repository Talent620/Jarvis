# CHANGELOG — JARVIS

Format wg [Keep a Changelog]. Sekcja „Unreleased" = bieżący branch
`claude/functionality-modification-access-z9kod1` (PR #1 → main).

## [Unreleased]

### „Refleks i Kora" — Część II (Zadania 8–14, metakognicja; wszystko opt-in)
- **Z8 — Brama Pewności (`confidenceGate`):** `confidence.ts` — czysta heurystyka `estimateConfidence`
  (wahanie/odmowa/pustka/degeneracja/za-krótko-vs-złożoność). Gdy refleks lokalny niepewny
  (`< confidenceThreshold`, domyślnie 0.55) i jest sieć → tura eskaluje do silniejszego dostawcy
  (Kory); lokalna odpowiedź trzymana jako deska ratunku, gdyby Kora padła. Decyzja w `logRouteDecision`.
- **Z9 — Spekulacja (`speculativeMode`, draft-then-verify):** `speculative.ts` — dla zadań `complex`
  lokalny model streamuje draft (widać tekst od razu), równolegle Kora weryfikuje. Zgodne (niska
  rozbieżność, Jaccard z lekkim stemmingiem PL) → tani lokalny draft; rozbieżne → korekta Kory.
  Padnie Kora → draft finalny (graceful). Orkiestracja z wstrzykiwalnymi runnerami (testowalna).
- **Z10 — Konsylium Hybrydowe (`councilIncludeLocal`):** lokalny model (Ollama) dołącza jako DODATKOWY
  głos w naradzie (na końcu listy — sędzia zostaje najlepszą Korą). `askMember` obsługuje keyless
  (Ollama/WebLLM = „local"). Bez chmury + sam lokalny → narada degraduje do single (działa offline).

### „Refleks i Kora" — Część I (Fundament, Zadania 1–7)
Dwuprędkościowy mózg: model lokalny (Refleks) staje się pełnym poziomem, nie tylko awaryjnym ogonem.
- **Z1 — katalog Ollamy pod ~4 GB VRAM (2026):** `qwen3.5:4b` (domyślny), `phi4-mini`, `gemma3:4b-it-qat`
  (wizja), `llama3.2:3b`, `qwen3:1.7b`, `gemma2:2b`, `deepseek-r1:1.5b`, `qwen2.5-coder:3b` (uncensored na końcu).
  `TASK_MODELS.ollama` → simple `qwen3:1.7b`, complex `qwen3.5:4b`, vision `gemma3:4b-it-qat`.
- **Z2 — dynamiczny dropdown modeli:** Settings wykrywa realne modele z `/api/tags` (debounce 600 ms +
  „🔄 Odśwież modele z Ollamy"); degradacja do listy statycznej, gdy serwer nieosiągalny.
- **Z3 — local-first:** setting `localFirstSimple` — proste zapytania (wg `classifyTask`) idą NAJPIERW do
  Ollamy (chmura fallbackiem); **offline → model lokalny na początek automatycznie**. complex/vision dalej
  chmura (chyba że `onDeviceOnly`). Decyzje logowane (`logRouteDecision`).
- **Z4 — tuning pod 4 GB:** `makeOpenAICompatible` przyjmuje `extraBody`; Ollama dostaje `keep_alive: "30m"`
  + `options.num_ctx/num_gpu` (settingi `ollamaNumCtx`=4096, `ollamaNumGpu`=-1). Zero zmian dla innych dostawców.
- **Z5 — health-check serwera inferencji:** `runHealthCheck` pinguje `/api/tags` (+ `/api/ps`: model w VRAM);
  z telefonu widać, czy domowe GPU żyje (np. przez Tailscale).
- **Z6 — infrastruktura `server/ollama/`:** README (Windows + Tailscale/Cloudflare + pułapka mixed-content),
  `docker-compose.yml` (Linux/NAS), `setup.ps1` (env + pull modeli + opcjonalny `tailscale serve`).
- **Z7 — testy:** routeOrder (local-first/offline/complex/onDeviceOnly) — 852 zielone; lint/tsc czyste.
Wszystkie nowe funkcje **opt-in** (domyślnie off), zachowanie domyślne bez zmian.

### Premium UX + niezawodność (po audycie „dlaczego wygląda amatorsko")
- **Streaming odpowiedzi (słowo-po-słowie)** dla WSZYSTKICH głównych dostawców: OpenAI-compat
  (Groq/Cerebras/OpenRouter/NVIDIA/GitHub/Ollama), **Claude** i **Gemini** — koniec „gapienia się
  w pusty orb". `stream.ts` (3 akumulatory SSE + `drainSSE`), bąbel tworzony leniwie przy 1. tokenie,
  akumulator per-próba (czysty failover), **bezpieczny fallback** do pełnej odpowiedzi (najgorszy
  przypadek = obecne zachowanie). Claude: streaming wyłącza „thinking" (poprawne tury z narzędziami);
  Gemini: streaming tylko bezpośrednio (proxy → pełna odpowiedź).
- **Rdzeń niezawodności** (`resilience.ts`): wykładniczy backoff+jitter, deduplikacja żądań,
  circuit breaker per-dostawca (half-open), cache warstwowy (RAM+IndexedDB, TTL). Wpięty w `brain.ts`.
- **Obserwowalność** (`errorLog.ts`): lokalny pierścień zdarzeń + metryki (latencja p50/p95,
  successRate, błędy per scope) — bez wysyłki na zewnątrz.
- **Jednolity styl komunikatów**: `normalizeToastText` usuwa znaczniki „✓/✅/✔" (toast SAM jest
  potwierdzeniem), zachowuje emoji semantyczne; pomocnicy `toastOk/toastErr/toastInfo`.
- Dokumentacja: `docs/PREMIUM_AUDIT.md` (brutalny audyt + dowody) i `docs/ROADMAP.md`.
- +37 testów (resilience, errorLog, stream ×3 formaty, toast). Razem **815+** zielonych; build OK.


### Faza 6 (część bezpieczna) + utwardzenie (CORS Electron, BFF fail-closed)
- **Saldo OpenRouter (read-only):** `openrouterBalance.ts` — `GET /credits`, `parseCredits`/`isLowBalance`
  (czyste). Saldo + alert niskiego stanu w ekranie 💸 Koszty AI; próg `openrouterLowBalanceUsd` (0 = off).
  **Zero płatności** — sam odczyt. +3 testy.
- **Electron CORS (zero-regresji):** koniec blankietowego nadpisywania `Access-Control-Allow-Origin: *`
  na każdej odpowiedzi — gdy serwer ma własną politykę CORS, zostawiamy ją; permisywne nagłówki
  dokładamy tylko tam, gdzie odpowiedź ich nie ma (czyli gdzie i tak były potrzebne). Nic działającego
  się nie psuje, znika nadgorliwe rozluźnianie cudzych polityk.
- **BFF fail-closed (opt-in):** `appTokenBad` honoruje `REQUIRE_APP_TOKEN=1` — wtedy wymaga poprawnego
  `x-app-token` ZAWSZE (brak skonfigurowanego `APP_TOKEN` ⇒ odrzuć, zamiast po cichu wpuszczać).
  Domyślnie bez zmian (egzekwcja tylko gdy `APP_TOKEN` ustawiony) — zero ryzyka dla obecnych wdrożeń.
  Trasy proxy (anthropic/gemini/openai/passthrough) idą teraz przez wspólny `appTokenBad`. +4 testy
  (worker walidowany `node --check`). **Deploy fail-closed:** ustaw w workerze `APP_TOKEN` ORAZ
  `REQUIRE_APP_TOKEN=1`, a w buildzie klienta `VITE_APP_TOKEN` = ten sam token.

### Bezpieczeństwo — szyfrowanie kluczy API w spoczynku (opcjonalne)
- **`secretsVault.ts`:** opt-in blokada kluczy hasłem (AES-256-GCM + PBKDF2, format JV2). Domyślnie
  **wyłączone** → zero zmian dla obecnych użytkowników. Po włączeniu: klucze w PAMIĘCI pozostają jawne
  (wszyscy czytelnicy bez zmian), a na DYSK (`localStorage`) idą wyłącznie zaszyfrowane (osobny blob
  `jarvis.secrets.v1`; pola wrażliwe w `settings.v2` wymazane przez `setSettingsPersistTransform`).
  Przy starcie ekran odblokowania (`UnlockKeys`), kontrolki włącz/wyłącz w ⚙ → AI. Odzyskiwalne:
  zapomniane hasło = wpisz klucze ponownie (odtwarzalne) — nic nieodwracalnego. +7 testów. Domyka
  pozycję odłożoną z `SECURITY.md` (klucze BYOK plaintext).

### Program premium — Faza 9 (produktyzacja)
- **White-label:** ustawienie `brandName` + helper `brand()` (domyślnie „JARVIS", cap 32) — własna marka
  w nagłówku, ekranie powitalnym (onboarding) i rozmowie na żywo; pole w ⚙ → Zachowanie. Nie zmienia
  działania modelu, tylko prezentację. +4 testy.
- **Onboarding kluczy:** potwierdzony (istniejący `Onboarding.tsx`: wklej dowolny klucz → auto-rozpoznanie
  dostawcy → test połączenia → wybór imienia/charakteru → tour).
- **Docs:** `USER_GUIDE.md` — przewodnik użytkownika (onboarding, klucze/auto-failover, rozmowa/czat prywatny,
  pamięć, koszty/budżet, prywatność i tryb on-device, white-label, instalacja APK/EXE/PWA).

### Program premium — Faza 8 (tryb on-device / prywatność)
- **Twarda blokada chmury:** ustawienie `onDeviceOnly` — `routeOrder` zwraca wtedy wyłącznie model
  lokalny (Ollama), nigdy chmury; web-search wyłączony (zero egres do sieci). Bez skonfigurowanej
  Ollamy rozmowa zgłasza czytelną instrukcję zamiast cicho sięgać do chmury. Toggle w ⚙ → AI. +3 testy.
  Decyzja: bez wbijania WASM/WebGPU (WebLLM) w bundle PWA — model lokalny przez Ollamę; WebLLM jako opcja przyszła.

### Program premium — Faza 7 (proaktywność + pamięć epizodyczna)
- **`episodicMemory.ts`:** dziennik zdarzeń (czas+temat) — `topicOf`/`keywords`/`topTopics` oraz
  `staleRecurringTopics` (tematy częste w 30 dni, ale porzucone w ostatnich dniach). Zapis epizodu po
  każdej wymianie w `brain.ts` (localStorage, cap 500). +5 testów.
- **`proactivity.ts`:** `staleTasks`/`upcomingEvents`/`buildSuggestions` — propozycje „z inicjatywy":
  najbliższe wydarzenie → poranny briefing → zaległe zadania (>3 dni) → powracający porzucony temat.
  Czysta logika (`proactiveSuggestions()` czyta store+epizody). +7 testów.
- **UI:** sekcja **💡 Propozycje JARVIS-a** w Centrum powiadomień.

### Faza 6 — POMINIĘTA (decyzja właściciela): nie dotykam płatności/auto-top-up.

### Program premium — Faza 5 (panel kosztów)
- **Telemetria zużycia tokenów:** adaptery `anthropic`/`gemini`/openai-compat zwracają teraz
  `usage` (sumowane przez całą turę, łącznie z pętlą narzędzi) → `JarvisReply.usage`.
- **`usageTelemetry.ts`:** wycena (cennik domyślny + nadpisania w configu), agregacje (dziś/7/30 dni),
  rozbicie per dostawca/model, prognoza miesięczna (run-rate 7 dni × 30), status budżetu (⚠ ≥80%, ⛔ ≥100%).
  Zapis w `brain.ts` po udanej odpowiedzi (localStorage, cap 2000). +9 testów.
- **Ekran 💸 Koszty AI** (`CostPanel`, z menu „Więcej"): sumy, prognoza, pasek budżetu, rozbicia,
  edycja budżetu i cennika (JSON), ostatnie decyzje routera (Faza 4). Ustawienia: `aiMonthlyBudgetUsd`, `aiPricingOverrides`.

### Program premium — Faza 4 (router modeli)
- **`modelRouter.ts`:** `classifyTask` (simple/complex/vision wg heurystyk: kod/analiza/długość/obraz),
  router Groq **Llama 4 Scout** (szybki, multimodalny — proste+wizja) vs **Kimi K2** (mocne rozumowanie/kod),
  **dziennik decyzji** (`logRouteDecision`/`getRouteLog`, ring 100 — zasila panel kosztów Fazy 5).
  Wpięte w `brain.ts` (`TASK_MODELS.groq` → Scout/Kimi; log faktycznej, udanej decyzji + flaga failover);
  Scout/Kimi dodane do `registry.ts` (Scout domyślny dla Groq). Retry+fallback już były (`withRetry`+łańcuch).
  Osobowość bez zmian. **Decyzja:** bez Mastry w bundlu PWA (Node/serwer-first) — te same pojęcia lekko. +8 testów.

### Program premium — Faza 3 (głos live)
- **Pamięć Mem0 w głosie:** `LiveOverlay` pobiera trafny kontekst i buduje `systemPrompt({ mem0Block })`
  przed startem sesji Gemini Live — głos „pamięta" to samo co czat (degraduje cicho bez serwisu).
  Token startu (`genRef`) chroni przed wyścigiem przy przełączaniu silnika/zamknięciu.
- **Narzędzia w sesji live (function calling):** `LiveSession` wysyła deklaracje funkcji i obsługuje
  `toolCall`/`toolResponse`. Wystawiany jest **bezpieczny podzbiór**: `read`+`write` (odwracalne) oraz
  narzędzia **MCP** (Faza 2). `outbound` (mail/telefon/smart-home/pulpit) **pomijane** — w trybie live
  nie ma bramki zgody, więc błędne rozpoznanie mowy nie wywoła nieodwracalnej akcji (dodatkowy blok
  defensywny w runnerze). Pełny tok z potwierdzeniami pozostaje w czacie i „Trybie rozmowy". +3 testy.
- **Kamera w trybie live (opcjonalna, domyślnie OFF):** `LiveSession.startCamera/stopCamera` —
  tylna kamera, klatki JPEG 1 fps 640×480 wysyłane jako `realtimeInput` (model „widzi"), sprzątane
  przy teardown/błędzie; przycisk „📷 Pokaż kamerę" w `LiveOverlay`. Uprawnienie CAMERA już w manifeście.

### Program premium — Faza 0 + Faza 1 + Faza 2
- **Faza 2 — warstwa MCP:** `mcp.ts` (`McpManager`) — klient zgodny z MCP (JSON-RPC
  initialize/tools/list/tools/call), allowlista hostów (anty tool-poisoning), narzędzia
  rejestrowane w `toolDefs` (model widzi je natywnie; `runTool` routuje do serwera),
  ładowanie przy starcie + UI (config + lista narzędzi), graceful degradation. 7 testów.
  Decyzja: lekki klient protokolarny zamiast node-SDK w bundlu PWA; Google MCP dodany jako
  ścieżka konfigurowalna, `google.ts` pozostaje fallbackiem (bez wyrywania działającego kodu).

- **Faza 0:** `ARCHITECTURE.md` (mermaid + punkty zaczepienia) + 10-fazowy plan w `PROGRESS.md`.
- **Faza 1 — pamięć długoterminowa (Mem0 + Qdrant):** `server/` (docker-compose + .env.example +
  README), `memoryService.ts` (add/search/getAll/update/delete; namespace personal/business;
  graceful degradation), wpięcie w `brain.ts` (search przed modelem → blok w system prompt;
  add po odpowiedzi), pole konfiguracji w ⚙ Integracje + test połączenia. 8 testów (w tym
  izolacja namespace) zielonych. Live wymaga hosta Docker; bez niego JARVIS działa normalnie.

### Funkcje
- **Czat prywatny / tymczasowy (jak w ChatGPT):** nowy przełącznik 🕶 w nagłówku — rozmowa
  w tym trybie **nie trafia do historii** (pomijany `upsertChat`), startuje czysto, znika po
  odświeżeniu. Widoczny baner „nie zapisuję tej rozmowy" + wyjście jednym kliknięciem.
  „Nowa rozmowa" i otwarcie zapisanej rozmowy wychodzą z trybu prywatnego.
  *(Historia czatów — lista, wyszukiwarka, grupowanie po dacie, zmiana nazwy, usuwanie —
  już istniała w `chats.ts` + `ChatHistory.tsx`; dodano brakujący tryb prywatny.)*

### Poprawność współbieżności
- **brain.ts:** `deepAnalysis`/`currentKnowledge`/`journalRank` przeniesione z **globali modułu**
  do kontekstu per-żądanie (`systemPrompt(ctx)`). Usuwa przeciek kontekstu między równoległymi
  `askJarvis` oraz „resztki" z ostatniego czatu w trybie live (LiveOverlay dostaje czysty prompt).

### Przegląd modułów produktywności (bug-hunt nieaudytowanej części)
- **autoPlan.ts (Krytyczny):** follow-upy kumulowały się bez końca — `sourceId` koduje
  `followUpCount`, więc każdy cykl tworzył nowe zadanie, a stare nigdy nie były zamykane
  (chyba że lead won/lost). Teraz pętla auto-domykania zamyka też zadania `fup:` spoza
  bieżącego zestawu „want" (zastąpione/nieaktualne). +test regresyjny.
- **markets.ts:** krypto pokazywało kanoniczne id CoinGecko (`BITCOIN`) zamiast symbolu
  (`BTC`); przy braku `usd_24h_change` rysowało fałszywą strzałkę „▼0.0%". Naprawione
  (symbol użytkownika + brak strzałki/%, gdy danych zmiany brak).
- **notifyCenter.ts:** suma „pilnych" podwójnie liczyła follow-upy (raz jako follow-up,
  raz jako zadanie autopilota). Wykluczono zadania-źródła `fup:`/`call:` z `tasksToday`.
- **taskParser.ts:** miesięczne powtarzanie dryfowało na krótkich miesiącach (31 I → 3 III).
  Dodano przytrzymanie dnia do końca miesiąca. +test.
- **weather.ts:** „NaN°"/„null%" przy niekompletnych tablicach dziennych / null opadów —
  dodane zabezpieczenia.
- **notifications.ts:** minutnik z ogromną liczbą minut przepełniał `setTimeout` (>2^31 ms)
  i odpalał natychmiast — dodany clamp do ~24 dni.
- **glinks.ts:** `splitOffer` — regex „Temat:" zakotwiczony do początku linii (m) + obsługa
  CRLF (nie ucina maila przy „Temat:" w treści).
- **deviceCalendar.ts / deviceContacts.ts:** guard `|| []` na `calendar`; sprawdzenie wyniku
  zgody na kontakty przed `getContacts`.
- **Noted-not-changed (rule #6, niepewne/ryzykowne):** `taskParser` bierze gołe liczby
  dziesiętne (`1.5 kg`) i 2-literowe skróty dni jako daty — naprawa zmienia parsowanie,
  wymaga projektu; `glinks.smsUrl` używa `?&body=` (autor twierdzi, że działa na Android+iOS).

### Bezpieczeństwo
- **BFF (`proxy/worker.js`):** naprawiony realny bug — `b64` niezdefiniowane w `/v1/gmail/send`
  powodowało 500 przy każdym mailu z polskim tematem; sanityzacja CRLF w SMTP/MIME (anty-injection);
  klucz Gemini przeniesiony z URL do nagłówka `x-goog-api-key`; cap `texts[]` w `/v1/embed`;
  **blok SSRF do metadanych chmury** w `/passthrough` (169.254.x, metadata.google.internal — z
  zachowaniem LAN/Home Assistant); auth `x-app-token` egzekwowany na `/v1/search|embed` gdy
  `APP_TOKEN` ustawiony; timeouty na wszystkich zewnętrznych fetchach; guard `JARVIS_KV` w OAuth
  callback; 500 zwraca generyczny komunikat.
- **sales-os:** per-lead outreach respektuje `autoSendEmails` + `dailyEmailCap` (koniec
  nieograniczonej wysyłki); rate-limit na token zamiast podrabialnego `X-Forwarded-For`;
  minimalna długość tokenu 6 → 24; timeouty Resend/Mailgun.
- **Klient:** walidacja ustawień przy imporcie kopii (`sanitizeImportedSettings` — blokada
  podmiany adresów-endpointów bez potwierdzenia, anty-eksfiltracja kluczy/maila); sejf rygluje
  się przy błędnym haśle (`vault.unlockVault`); audyt redaguje `input` (bez treści maili/base64
  w plaintext); PIN na PBKDF2 (210k) z migracją starego SHA-256; cipher z wersjonowanym KDF
  (format `JV2`, iteracje w nagłówku — bezpieczne przyszłe podniesienie); `calculate` bez
  `Function()` (parser `safeCalc`).
- **Electron:** `will-navigate`/`will-redirect` guard (renderer nie opuści `file://`);
  `sandbox: true`; `isTrustedIpc` na uprzywilejowanych IPC (open/launch/power/.../google/smtp/notify);
  DevTools tylko w buildzie dev.
- **CI:** usunięte martwe, mylące wstrzykiwanie `JARVIS_*_KEY` (footgun) z 4 workflowów;
  Android: gitignore keystore + parametryzacja podpisywania przez env.
- **Leady:** guard URL (tylko http/https) w Pulpicie i Teczce; limity długości pól z OSM.

### Niezawodność / wydajność
- **Sync:** `pullSync` scala po `id` (nowsze `updatedAt`/`createdAt` wygrywa) zamiast hurtowo
  nadpisywać — koniec utraty lokalnych edycji między urządzeniami.
- **Głos/audio:** naprawiony wyciek węzłów Web Audio przy premium-TTS; teardown `LiveSession`
  na błędzie WS (koniec stackowania mic/AudioContext); backoff + poddanie restartu Web Speech;
  cleanup `loadVoices`; guard tury w `speak()`.
- **Store:** capy logów (`sentMail`/`contentPosts` ≤ 500) + trwały sygnał przy braku miejsca
  (`isStorageFull`) zamiast cichej utraty danych.
- **Inne:** limit nagrania w Transcribe (10 min); debounce `devicechange` w wykrywaniu słuchawek;
  batch zapisu przypomnień; decay licznika restartów w `ErrorBoundary`.

### Funkcje (wcześniej w tej sesji)
- Integracja z osobnym CRM **AI Sales OS** (`sales-os/`): sync leadów (dodaj+odśwież),
  push leadów, AI-outreach z auto-wysyłką, dwukierunkowa zmiana statusu — przez tokenowane
  endpointy publiczne; E2E smoke w CI; turnkey deploy na Vercel.

### Dokumentacja
- Dodane: `AUDIT.md` (audyt 6 klastrów), `PROGRESS.md`, `DEVLOG.md`, `INTEGRATION.md`,
  `CHANGELOG.md` (ten plik); `SECURITY.md` rozszerzony o listę kontrolną utwardzenia.

### Świadomie odłożone (wymagają decyzji właściciela — `AUDIT.md §9`, `SECURITY.md`)
- BFF fail-closed `APP_TOKEN`; `admin.ts` (sekret na nr telefonu); consent fail-closed dla
  outbound; rotacja keystore + self-signed EXE; `release.yml`
  na push brancha; Electron/sales-os wildcard CORS. Każde albo zmienia logowanie/tryb live,
  albo jest nieodwracalne, albo mogłoby zerwać działające wdrożenie.

### Jakość
- Testy: 665 → **685** (Vitest) zielone. Build web/APK/EXE zielone w CI. Worker walidowany
  `node --check` + osobny test logiki SSRF.
