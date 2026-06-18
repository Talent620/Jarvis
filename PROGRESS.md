# JARVIS — Postęp prac (Faza 2)

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
4. **`sync.ts`** — merge po `id`+`updatedAt` zamiast last-write-wins.
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
Batche 1–6 wdrożone i wypchnięte (commity `e1e983e → 45905dd`). 665 → **674 testy** zielone.
