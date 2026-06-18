# JARVIS — Postęp prac

## ▶ PROGRAM ON-DEVICE (aktywny) — warstwa AI lokalna (WebGPU/WASM) + fundament IndexedDB

Baza startowa: **760 testów zielone** (753 + 7 z Fazy A), web build OK, branch `claude/functionality-modification-access-z9kod1`.
Zasady: on-device = OPCJA z capability-check + cichy fallback do chmury; inferencja w Web Workerze; wagi w IndexedDB; commit po fazie; STOP tylko przy płatnościach i zmianach mogących zerwać wdrożenie (BFF/keystore/CORS — Faza F).

- [x] **Faza A — Fundament: IndexedDB (Dexie)** ✅ `src/lib/db.ts` (tabela klucz→wartość, bezpieczny fallback gdy brak IndexedDB). Duże kolekcje (`memory` z embeddingami, `sentMail`, `contentPosts`) przeniesione z localStorage do IndexedDB jako **warstwa trwałości** — `store.data` zostaje w RAM i synchroniczne (zero zmian u callerów). **Migracja jednorazowa** przy starcie (localStorage→IDB, dane usuwane z localStorage dopiero po udanym zapisie + fladze — idempotentnie) + **hydratacja** przy kolejnych startach. Zdejmuje dług #1 z AUDIT.md (sufit ~5 MB). Zapis do IDB debounced (300 ms). 7 testów (roundtrip db, migracja+odchudzenie blobu, hydratacja, debounce); **760 zielonych**; build OK. Bundle +~27 KB gzip (Dexie, rdzeń ładowany od startu).
- [ ] **Faza B — Pamięć on-device (Transformers.js embeddingi)** — w toku.
- [ ] **Faza C — Mózg on-device (WebLLM provider)**
- [ ] **Faza D — Głos on-device (Whisper STT + Silero VAD + Kokoro TTS)**
- [ ] **Faza E — Odświeżenie modeli + brama OpenRouter**
- [ ] **Faza F — Utwardzenie pod sprzedaż (STOP-and-ASK na ryzykownych)**
- [ ] **Faza G — Samokontrola + RELEASE_NOTES.md**

### Decyzje (Program on-device)
- **Warstwa trwałości, nie przepisanie store:** wybrałem podejście „store w RAM + split trwałości" zamiast async-owego API store — zero zmian u setek callerów, pełna wsteczna zgodność, trywialny rollback (czytaj z localStorage). Embeddingi (główny żłop quota) lądują w IDB wraz z kolekcją `memory`.
- **Ciężkie biblioteki ML (Fazy B–D) ładowane LENIWIE** (dynamic import w Web Workerze) — nie wchodzą do głównego bundla; ścieżka chmurowa pozostaje lekka.

---

## ▶ PROGRAM 10 FAZ (zamknięty) — produkt premium na sprzedaż

Baza: **685 testów zielone**, web build OK, na branchu `claude/functionality-modification-access-z9kod1`.
Zasada: faza nie zamyka się bez zielonych testów + buildu; commit po każdej fazie; STOP tylko przy płatnościach (Faza 6).

### Realność wykonania (uczciwie, na starcie)
Część faz to **net-new, ciężka infrastruktura**, której nie da się w pełni *uruchomić* w tym środowisku
(brak działającego demona Docker, brak kluczy live, APK buduje wyłącznie CI). Dlatego:
- Kod + testy (mock/HTTP) + **graceful degradation** wdrażam normalnie.
- „Żywe" usługi (Qdrant/Mem0 przez Docker, Gemini Live na kluczu, podpisany APK) wymagają hosta/kluczy
  po Twojej stronie — zaznaczam to przy każdej fazie. To nie wymówka, to warunek brzegowy środowiska.
- **Decyzja architektoniczna:** Mem0+Qdrant (Faza 1) i lokalny model (Faza 8) zakładają **host serwera**,
  którego dziś nie ma (klient to PWA + Worker; Worker nie uruchomi Qdrant). Stawiam je jako **osobny
  serwis `server/` (docker-compose)** zgodnie z fazą; klient łączy się przez env URL i działa też bez niego.

### Status faz
- [x] **Faza 0 — Audyt i fundament:** `ARCHITECTURE.md` (mermaid + punkty zaczepienia) + ten plan + git. ✅
- [x] **Faza 1 — Pamięć (Mem0 + Qdrant):** ✅ `server/docker-compose.yml` (Mem0+Qdrant) + `.env.example` + README; `memoryService.ts` (add/search/getAll/update/delete, 2 namespace'y personal/business, graceful degradation); wpięte w `brain.ts` (search PRZED → blok w `systemPrompt`; add PO odpowiedzi, w tle); UI w ⚙ Integracje (adres/token/test). Testy 8/8 (dodanie, retrieval, **izolacja namespace**, degradacja) zielone; build OK. **Live Qdrant wymaga Twojego hosta Docker** (klient działa też bez niego). Debug/podgląd: `GET /memories?user_id=…` (token).
- [x] **Faza 2 — MCP:** ✅ `mcp.ts` `McpManager` (klient zgodny z MCP: JSON-RPC initialize/tools/list/tools/call), **allowlista hostów** (anty tool-poisoning), narzędzia rejestrowane w `toolDefs` przez `registerTool` (model widzi je natywnie; `runTool` routuje do serwera), ładowanie przy starcie + UI (config JSON + lista załadowanych narzędzi), graceful degradation. 7 testów (ładowanie z mocka, wykonanie wywołania, **odrzucenie spoza allowlisty**, brak sieci) zielone; build OK. **Decyzje:** (1) lekki klient zgodny z protokołem zamiast node-SDK w bundlu PWA (browser-compat+rozmiar); (2) Calendar/Gmail — ścieżka MCP **dodana** (podajesz URL serwera Google MCP w configu), `google.ts` **zostawiony jako fallback** — NIE wyrwałem działającego kodu (wymagałoby realnego serwera MCP+OAuth i łamałoby kompatybilność).
- [x] **Faza 3 — Głos live (Gemini Live):** ✅ *bazuje na istniejącym* (`liveVoice.ts` WS+barge-in). ✅ Wpięta **pamięć Mem0** (Faza 1) — `LiveOverlay` pobiera trafny kontekst i buduje `systemPrompt({ mem0Block })` przed startem sesji (degraduje cicho bez serwisu); token startu (`genRef`) chroni przed wyścigiem przy przełączaniu silnika/zamknięciu. ✅ Uprawnienia Android obecne w manifeście (RECORD_AUDIO/CAMERA/MODIFY_AUDIO_SETTINGS); runtime przez WebView (Capacitor). ✅ Fallback: błąd mikrofonu/WS → czytelny komunikat + „Tryb rozmowy (dowolny model)" + tekst. ✅ **Narzędzia w sesji live (function calling):** Gemini Live dostaje deklaracje funkcji i woła je przez `toolCall`/`toolResponse`. **Bezpieczeństwo:** wystawiamy tylko `read`+`write` (odwracalne, z undo) oraz narzędzia **MCP** (Faza 2); `outbound` (wysyłka maila/telefon/smart-home/pulpit) **pomijane** — w trybie live nie ma bramki zgody, więc błędne rozpoznanie mowy nie wywoła nieodwracalnej akcji (dodatkowo defensywny blok w runnerze). 3 testy. ✅ **Toggle kamery** (domyślnie OFF): `startCamera/stopCamera` w `LiveSession` (tylna kamera, klatki JPEG 1 fps 640×480 → realtimeInput; sprzątane w teardown) + przycisk „📷 Pokaż kamerę" w `LiveOverlay`; uprawnienie CAMERA w manifeście. 703 testy zielone; build OK.
- [x] **Faza 4 — Router modeli (Groq: Scout vs Kimi):** ✅ `modelRouter.ts` — `classifyTask` (simple/complex/vision wg heurystyk: kod/analiza/długość/obraz), `groqModelFor` (**Llama 4 Scout** do prostych+wizji, **Kimi K2** do rozumowania), **dziennik decyzji** (`logRouteDecision`/`getRouteLog`, ring 100 — zasila panel kosztów Fazy 5). Wpięte w `brain.ts` (`TASK_MODELS.groq` → Scout/Kimi; log faktycznej, udanej decyzji z flagą failover). Modele Scout+Kimi w `registry.ts` (Scout domyślny dla Groq). Retry+fallback **już są** (`withRetry` + łańcuch dostawców). Osobowość bez zmian (router dotyka tylko wyboru modelu). 8 testów; 711 zielonych; build OK. **Decyzja:** nie wciągam Mastry do bundla PWA (Node/serwer-first, rozdęłoby bundle) — realizuję te same pojęcia lekko (router+dziennik+retry/fallback), jak przy MCP w Fazie 2.
- [x] **Faza 5 — Panel kosztów:** ✅ `usageTelemetry.ts` — wycena (cennik domyślny + **nadpisania w configu**), agregacje (dziś/7/30 dni), rozbicie per dostawca/model, **prognoza** (run-rate 7 dni × 30), **budżet** (status: ostrzeżenie ≥80% / przekroczenie). Token usage zbierany realnie ze wszystkich adapterów (`anthropic`/`gemini`/openai-compat — sumowany przez pętlę narzędzi) → `JarvisReply.usage`; zapis w `brain.ts` po udanej odpowiedzi (localStorage, cap 2000). Osobny ekran **💸 Koszty AI** (z menu „Więcej") + edycja budżetu/cennika + ostatnie decyzje routera. 9 testów; 720 zielonych; build OK.
- [⤼] **Faza 6 — Saldo/OpenRouter:** ⛔ **POMINIĘTA na wyraźną decyzję właściciela** (2026-06-18) — nie dotykam płatności/auto-top-up. Do wznowienia na życzenie (bezpieczna część: odczyt salda `GET /credits` + alert; auto-top-up tylko po świadomej zgodzie).
- [x] **Faza 7 — Proaktywność + pamięć epizodyczna:** ✅ `episodicMemory.ts` — dziennik zdarzeń (czas+temat), `topicOf`/`keywords`, `topTopics`, **`staleRecurringTopics`** (częste w 30 dni, porzucone ostatnio); zapis epizodu po każdej wymianie w `brain.ts` (localStorage, cap 500). `proactivity.ts` — `staleTasks`/`upcomingEvents`/`buildSuggestions` (najbliższe wydarzenie → poranny briefing → zaległe zadania → powracający temat); `proactiveSuggestions()` czyta store+epizody. UI: sekcja **💡 Propozycje JARVIS-a** w Powiadomieniach. 12 testów; 732 zielone; build OK.
- [x] **Faza 8 — Tryb on-device (offline/prywatność):** ✅ twarda blokada chmury — ustawienie `onDeviceOnly`; `routeOrder` zwraca wtedy **wyłącznie** model lokalny (Ollama), nigdy chmury; web-search wyłączony (zero egres). Bez Ollamy → czytelny błąd z instrukcją (zamiast cichego sięgania do chmury). Toggle w ⚙ → AI („🔒 Tryb on-device (blokada chmury)"). 3 testy; 735 zielone; build OK. **Decyzja:** zgodnie z linią Fazy 2/4 nie wbijam silnika WASM/WebGPU (np. WebLLM) w bundle PWA — model lokalny realizujemy przez Ollamę (już zintegrowaną), a on-device-only to twarda gwarancja prywatności; WebLLM zostaje jako opcja przyszła.
- [x] **Faza 9 — Produktyzacja:** ✅ **Onboarding kluczy** już był solidny (`Onboarding.tsx`: wklej dowolny klucz → auto-rozpoznanie dostawcy → test → 3 kroki) — potwierdzone. **White-label:** ustawienie `brandName` + helper `brand()` (domyślnie „JARVIS", cap 32, przycięte); wpięte w nagłówek, ekran powitalny i rozmowę na żywo; pole w ⚙ → Zachowanie. **Docs:** `USER_GUIDE.md` (przewodnik użytkownika: onboarding, klucze, pamięć, koszty, prywatność/on-device, white-label, instalacja). 4 testy; 739 zielone; build OK.
- [x] **Faza 10 — Samokontrola + `RELEASE_NOTES.md`:** ✅ pełny self-check (`tsc` czysty, `npm run build` OK, **739 testów** zielonych, skan sekretów czysty); `RELEASE_NOTES.md` podsumowuje cały program (fazy 0–10, decyzje, odłożone). Program premium domknięty (Faza 6 pominięta na decyzję właściciela).

### Znane problemy / decyzje (Faza 0)
- Brief mówił „Node za tunelem Cloudflare" — realnie **Cloudflare Worker**; Mem0/Qdrant wymagają
  *nowego* hosta serwera (poza Workerem). Przyjęto: osobny `server/` + docker-compose.
- Sekrety klienta (klucze BYOK) są dziś w localStorage *plaintext* — do utwardzenia w Fazie 9 (onboarding) i wg `SECURITY.md`.

---

# (Archiwum) Wcześniejszy przegląd — Postęp prac (Faza 2)

Bazowo: 665 testów zielone. Każda partia: zmiana → test/build → commit.

## Plan napraw (bezpieczne, wysoki wpływ, niskie/średnie ryzyko)

### Batch 1 — BFF `proxy/worker.js`
- [x] (C) REALNY BUG: `b64` niezdefiniowane w `/v1/gmail/send` → 500 na PL tematach — dodać moduł-globalny `b64`.
- [x] (M3) Sanityzacja CRLF w SMTP/MIME (`to/user/subject/inReplyTo`).
- [x] (M4) Klucz Gemini z URL → nagłówek `x-goog-api-key` (`/v1/embed`, `/gemini`).
- [x] (M6) Cap długości `texts[]` w `/v1/embed`.
- [x] (m1) Timeouty na upstream-fetchach workera.
- [x] (M5) 500 → generyczny komunikat (bez `String(e)`).

### Batch 2 — sales-os public API
- [x] (C1) Per-lead outreach: gate na `autoSendEmails` + `dailyEmailCap`.
- [x] (C2) Rate-limit wysyłki: klucz na sam token (bez `X-Forwarded-For`).
- [x] (M2) Token min. długość 24.
- [x] (m6) Timeout na fetch w `email/index.ts`.

### Batch 3 — klient: głos + store + backup + bezpieczeństwo
- [x] (Voice D) `playUrlWithLevel` — odłączać węzły audio (lub kierować przez `playUrlEnded`).
- [x] (Voice M4) Backoff + give-up na restart Web Speech.
- [x] (Voice m2/m6) `loadVoices` cleanup + `speakToken` guard w gałęziach Fish/ElevenLabs.
- [x] (Data E) `backup.ts` — walidacja/whitelist ustawień przy imporcie (pola-endpointy).
- [x] (Store M4/M5) Quota: głośny trwały sygnał + capy `memory`/`sentMail`/`contentPosts`.
- [x] (Audit M4) Redakcja `input` w `audit()`.
- [x] (m1) `ErrorBoundary` — decay licznika restartów.

### Batch 4 — Electron
- [x] (M4) `will-navigate` guard + `sandbox:true` + `isTrustedIpc` na google/smtp/notify.
- [x] (m3) DevTools tylko gdy `!app.isPackaged`.

### Batch 5 — leady + LeadDetail
- [x] (M3) Overpass: timeout per-mirror 12s.
- [x] (m4) `LeadDetail` — `window.open(lead.url)` przez wspólny guard http/https.
- [x] (m3) `parseElement` — limity długości pól.

### Batch 6 — krypto + CI
- [x] (cipher m4) Zapis `iter`+wersji w nagłówku `JV1:` (wstecznie zgodnie).
- [x] (CI M2) Usunąć martwe bloki `JARVIS_*_KEY` + mylące komentarze z workflowów.

## FAZA 3 — Podsumowanie

### Co naprawiono i ulepszono (wdrożone, przetestowane — 674 testy zielone)
**Bezpieczeństwo (wysoki wpływ):**
- BFF: realny bug Gmaila (`b64` → 500 na PL tematach); anty-injection CRLF w SMTP/MIME; klucz Gemini z URL → nagłówek; cap fan-outu `/v1/embed`; timeouty; generyczne 500.
- sales-os: per-lead outreach respektuje `autoSendEmails`+`dailyEmailCap` (koniec nieograniczonej wysyłki); rate-limit na token (nie na podrabialny XFF); token min. 24; timeouty poczty.
- Klient: import kopii waliduje ustawienia i pyta przy zmianie adresów-endpointów (koniec eksfiltracji kluczy); sejf rygluje się przy błędnym haśle; audyt redaguje `input`; cipher z wersjonowanym KDF (JV2, 210k, wstecznie zgodny).
- Electron: `will-navigate`+`sandbox`+`isTrustedIpc` na google/smtp/notify; DevTools tylko w dev.
- Leady: guard URL (http/https) w obu widokach; limity długości pól z OSM.
- CI: usunięto martwe, mylące wstrzykiwanie `JARVIS_*_KEY`.

**Niezawodność / wydajność:**
- Głos: koniec wycieku węzłów audio (premium TTS); backoff+poddanie restartu Web Speech; cleanup `loadVoices`; guard tury w `speak()`.
- Store: capy logów (sentMail/contentPosts) + głośny, trwały sygnał przy braku miejsca (koniec cichej utraty danych); Overpass 12s/mirror.
- `ErrorBoundary`: decay licznika restartów.

### Do mojej decyzji (NIE wdrożone — patrz AUDIT.md §9)
1. **BFF auth/SSRF/CORS** — `APP_TOKEN` fail-closed, allowlista `/passthrough`, auth na `/v1/search|embed|sync`. *Ryzyko: zerwanie działającego wdrożenia.*
2. **`admin.ts`** — sekret admina szyfrowany numerem telefonu (hash w bundlu) → przeprojektować logowanie właściciela + migracja.
3. **`permissions.ts`** — consent fail-closed dla outbound (dziś tryb live celowo omija zgodę).
4. ~~**`sync.ts`** — merge po `id`+`updatedAt`~~ ✅ ZROBIONE (Batch 7).
5. **Keystore Android + self-signed EXE** — rotacja klucza (nieodwracalne wobec Sklepu Play) / prawdziwy cert.
6. **`release.yml` na push brancha** — ograniczyć do tagów (zerwie obecny rolling `latest`).
7. **Electron wildcard CORS** — zawęzić do allowlisty hostów.
8. **sales-os CORS `*`** — allowlista (uwaga: webview Capacitora wymaga CORS).

### TOP 5 następnych kroków (priorytet)
1. **BFF fail-closed `APP_TOKEN` + auth na `/v1/*`** — największa dziura (anonimowe wydawanie kluczy + SSRF). Potrzebuję potwierdzenia, że Twój worker ma `APP_TOKEN`.
2. **`sync.ts` merge po `updatedAt`** — realna ochrona przed utratą danych między urządzeniami.
3. **`admin.ts` — odejście od sekretu na numerze telefonu** — chroni serwer licencji.
4. **Migracja `sentMail`/`contentPosts`/embeddingów do IndexedDB** — zdejmuje presję na localStorage.
5. **Decyzja o keystore/kluczach + `release.yml` na tagi** — domknięcie higieny wydania.

## Zrobione
- Batche 1–6 (`e1e983e → 45905dd`): bezpieczeństwo BFF/sales-os/klient/Electron/leady/CI + niezawodność głosu/store.
- Batch 7 (`6fd007c`): **sync merge** po `id` (nowsze wygrywa — koniec utraty edycji między urządzeniami) + batch zapisu przypomnień.
- Batch 8 (`84499d1`): LiveSession teardown na błędzie (koniec stackowania mic/AudioContext przy retry) + limit nagrania Transcribe (10 min) + debounce `devicechange` w headset.
- 665 → **678 testów** zielone. CI build+test zielone. Drzewo czyste.

### Pozostałe bezpieczne, ale z subtelną zmianą zachowania (czekają na nod)
- `brain.ts` globalny stan modułu → parametry: realna poprawka (przeciek kontekstu przy równoległych `askJarvis`), ale zmienia treść promptu w trybie live (dziś dziedziczy resztki z ostatniego czatu). Mały blast radius (2 callery) — zrobię na potwierdzenie.
