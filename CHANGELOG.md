# CHANGELOG — JARVIS

Format wg [Keep a Changelog]. Sekcja „Unreleased" = bieżący branch
`claude/functionality-modification-access-z9kod1` (PR #1 → main).

## [Unreleased]

### Program premium — Faza 3 (głos live)
- **Pamięć Mem0 w głosie:** `LiveOverlay` pobiera trafny kontekst i buduje `systemPrompt({ mem0Block })`
  przed startem sesji Gemini Live — głos „pamięta" to samo co czat (degraduje cicho bez serwisu).
  Token startu (`genRef`) chroni przed wyścigiem przy przełączaniu silnika/zamknięciu.
- **Narzędzia w sesji live (function calling):** `LiveSession` wysyła deklaracje funkcji i obsługuje
  `toolCall`/`toolResponse`. Wystawiany jest **bezpieczny podzbiór**: `read`+`write` (odwracalne) oraz
  narzędzia **MCP** (Faza 2). `outbound` (mail/telefon/smart-home/pulpit) **pomijane** — w trybie live
  nie ma bramki zgody, więc błędne rozpoznanie mowy nie wywoła nieodwracalnej akcji (dodatkowy blok
  defensywny w runnerze). Pełny tok z potwierdzeniami pozostaje w czacie i „Trybie rozmowy". +3 testy.

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
