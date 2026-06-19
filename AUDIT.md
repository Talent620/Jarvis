# JARVIS — Audyt architektoniczny (Faza 1)

> Senior-architect review całego projektu. Read-only ustalenia. Sortowane wg realnego wpływu (impact ÷ ryzyko naprawy).
> Status: 4 z 6 klastrów ukończone; 2 (sales/leads, native+build/CI) w toku — sekcje uzupełniane na bieżąco.
> Legenda: **Impact** H/M/L · **Risk-of-fix** H/M/L.

## 1. Mapa projektu (skrót)
- **Klient** (Vite + React + TS): `src/App.tsx` (orkiestracja, pętle `setInterval`), `src/lib/brain.ts` (mózg + failover providerów), `src/lib/tools.ts` (narzędzia + bramka zgód `permissions.ts`), `src/lib/store.ts` (reaktywny store na localStorage).
- **AI providerzy**: `src/lib/providers/*` (anthropic/openai/gemini/registry) — bezpośrednio lub przez BFF.
- **BFF**: `proxy/worker.js` (Cloudflare Worker) — relay kluczy, sync KV, SMTP/Gmail, OAuth Google, licencje, admin.
- **Głos/audio**: `voice.ts`, `liveVoice.ts` (Gemini Live WS), `voiceLoop.ts`, `whisperListener.ts`, `voiceCapture.ts`, `smartConversation.ts`, `headset.ts`.
- **Bezpieczeństwo/dane**: `vault.ts` (AES-GCM), `cipher.ts`, `lock.ts` (PBKDF2), `license.ts` (ECDSA P-256), `sync.ts`, `backup.ts`, `memory.ts`, `admin.ts`.
- **Sprzedaż**: `leads.ts`, `leadIntel.ts`, `salesEngine.ts`, `salesOs.ts` (łącznik z osobnym CRM-em `sales-os/`).
- **Natywne powłoki**: `electron/main.cjs` + `preload.cjs`, Capacitor (Android/iOS).

---

## 2. KRYTYCZNE / WYSOKI WPŁYW

### A. `proxy/worker.js` — BFF domyślnie otwarty (auth/ratelimit fail-open)  [Impact H · Risk M]
`worker.js:634-641` — sprawdzenie `APP_TOKEN` i `rateLimited()` działa **tylko gdy skonfigurowane** (`if (env.APP_TOKEN && …)`). Bez ustawienia `APP_TOKEN` trasy `/anthropic /openai /gemini /passthrough` są **nieuwierzytelnione** i relayują używając kluczy serwera → każdy, kto zna URL workera, wydaje Twoje kredyty AI. → **DO DECYZJI** (zmiana może zablokować działające wdrożenie bez `APP_TOKEN`).

### B. `proxy/worker.js` — `/passthrough` to nieautoryzowany SSRF-relay  [Impact H · Risk M]
`worker.js:669-676` — `/passthrough?u=<URL>` pobiera **dowolny** URL po stronie serwera i przekazuje nagłówek `authorization`. Brak allowlisty hostów (w przeciwieństwie do `/openai`). Pozwala uderzyć w `169.254.169.254`/sieci wewnętrzne. → **DO DECYZJI** (allowlista hostów może wymagać konfiguracji Home Assistant).

### C. `proxy/worker.js` — Gmail send 500 na polskich tematach (REALNY BUG)  [Impact H · Risk L] ✅ do naprawy
`worker.js:467-468` — wywołuje `b64(...)`, ale `b64` jest zdefiniowane tylko **lokalnie** w `smtpRelay` (l.32). W zasięgu modułu jest tylko `b64url`. Każdy temat z polskimi znakami → `ReferenceError` → 500, połknięty przez catch. Łamie wysyłkę Gmaila (apka jest PL-first). **FIX:** dodać moduł-globalny `b64`.

### D. `src/lib/voice.ts` — wyciek węzłów audio przy każdym premium-TTS  [Impact H · Risk L] ✅ do naprawy
`voice.ts:65-98` (`playUrlWithLevel`, używany przez Fish/ElevenLabs) tworzy `MediaElementAudioSourceNode`+`AnalyserNode` na współdzielonym `levelCtx` i **nigdy ich nie odłącza** (siostrzany `playUrlEnded` robi to poprawnie). Akumulacja węzłów + CPU w wątku audio przez całą sesję. **FIX:** odłączać węzły w `onended`/error (lub kierować przez `playUrlEnded`).

### E. `src/lib/backup.ts` — import backupu nadpisuje ustawienia bez walidacji  [Impact H · Risk L] ✅ do naprawy
`backup.ts:36-39` — `applyParsed` robi `store.setSettings(parsed.settings)` bez walidacji. Spreparowany plik może wstrzyknąć `proxyUrl`/`syncUrl`/`smtpHost` → cały ruch AI i poczta lecą na wrogiem kontrolowany endpoint (eksfiltracja kluczy i maili). `looksLikeBackup` sprawdza tylko tablice danych, nie ustawienia. **FIX:** whitelist typów + potwierdzenie przy zmianie pól-endpointów.

### F. `src/lib/admin.ts` — sekrety admina szyfrowane numerem telefonu, którego hash jest w binarce  [Impact H · Risk M]
`admin.ts:11,20-32` — admin token (może wydawać/odwoływać licencje) szyfrowany hasłem = numer telefonu; `OWNER_PHONE_HASH` (SHA-256 bez soli) zaszyty w bundle. Numer (~30 bitów) brute-force'uje się offline → przejęcie serwera licencji. → **DO DECYZJI** (zmiana logowania właściciela + migracja).

### G. `permissions.ts` — bramka zgód fail-open bez handlera UI  [Impact H · Risk M]
`permissions.ts:98` — `if (!consentHandler) return true;` → każde outbound (mail, SMS, `desktop_power`, masowa wysyłka) wykonuje się **bez zgody**, gdy handler nieustawiony (tryb live/headset/intencje/pluginy, lub przed commitem efektu w App). Komentarz wprost wyłącza zgodę w trybie live. → **DO DECYZJI** (fail-closed może zablokować flow hands-free).

---

## 3. WAŻNE (Major)

### Sieć / BFF
- **`/v1/sync` token = klucz KV bez walidacji** (`worker.js:286-305`) — dowolny niepusty Bearer; zgadnięcie tokenu = odczyt/nadpis cudzych danych. Podobnie `google:${token}` i `state` OAuth. [H·M] → DO DECYZJI.
- **SMTP/MIME header injection** (`worker.js:67-77, 461-497`) — `to/user/subject/inReplyTo` wstrzykiwane do protokołu bez filtrowania CRLF → relay spamu/wstrzyknięcie nagłówków. [M·L] ✅ do naprawy.
- **Klucz Gemini w URL** (`gemini.ts:50`, `worker.js:328,653`) — sekret w query-stringu (logi/historia/referrer). Google akceptuje nagłówek `x-goog-api-key`. [M·L] ✅ do naprawy.
- **`/v1/search`, `/v1/embed` nieautoryzowane + nieograniczony fan-out** (`worker.js:308-339`) — wydają klucze serwera; `/v1/embed` pętli po dowolnie długim `texts[]`. [M·L] ✅ (cap + auth).
- **Brak timeoutów na fetchach workera** (`relay()` i in.) — wiszący upstream blokuje invocation. [L·L] ✅.
- **500 zwraca surowy `String(e)`** (`worker.js:680`) — wyciek detali. [M·L] ✅.

### Orkiestracja / store
- **`store.data` (`jarvis.data.v2`) bez limitu** — `leads/sentMail/contentPosts/memory` rosną bez prune; przy zbliżeniu do ~5MB `write()` **po cichu** gubi WSZYSTKIE zapisy (jeden toast). [H·M] ✅ (głośna obsługa quota + capy).
- **Quota-write cichy data-loss** (`store.ts:118-130`) — `setData` zmutował RAM i `emit()`, a localStorage nie zapisał; UI pokazuje „zapisane". [M·L] ✅ do naprawy.
- **5× `setInterval`, nakładające się async** (`App.tsx:294,580,608,632,653`) — pętle tykają mimo wyłączonej funkcji; async może się nakładać. [M·L] ✅ (in-flight guard / self-scheduling).
- **Re-entrancy store w pętli przypomnień** (`App.tsx:582-595`) — `setData` w `forEach` → N zapisów+renderów/tick. [M·L] ✅ (batch).
- **Audit loguje `input` dosłownie** (treści maili/SMS/base64) bez redakcji w plaintext (`permissions.ts:70-75`). [M·L] ✅ (truncate jak output).
- **Globalny stan modułu w `brain.ts`** (`deepAnalysis/currentKnowledge/journalRank`) — przeciek kontekstu między równoległymi `askJarvis`. [M·M].
- **`useStore` re-render całego App + `upsertChat` serializacja na każdą wiadomość** (`useStore.ts`, `App.tsx:312`) — perf na długich czatach. [M·M] (selektory + debounce).

### Głos
- ~~**WhisperListener bez wyciszenia na czas TTS** (`whisperListener.ts:99-127`) — echo/samowyzwalanie na desktopie. [M·M].~~ ✅ **ZAMKNIĘTE (Faza D)**: `voice.ts` eksponuje `isSpeaking()`; `whisperListener.tick()` wycisza wejście na czas mówienia JARVIS-a (koniec echa/samowyzwalania).
- **`ScriptProcessorNode` always-on send** (`liveVoice.ts:166-178`) — stały uplink bez VAD. [M·M]. → **ODŁOŻONE świadomie (Faza D)**: Gemini Live opiera endpointing/barge-in na CIĄGŁYM strumieniu — VAD-bramkowanie lub wymiana węzła „w ciemno" grozi zerwaniem działającego rozpoznawania końca tury; brak możliwości testu audio w tym środowisku. Zostawione do ręcznej weryfikacji na żywym kluczu.
- **`LiveSession` błąd nie sprząta WS/mic** (`liveVoice.ts:81-111`) — przy retry stackują się konteksty. [M·M].
- **`ScriptProcessorNode` always-on send** (`liveVoice.ts:166-178`) — stały uplink bez VAD, bateria/CPU. [M·M]. (patrz wyżej — odłożone w Fazie D jako ryzyko dla działającego Gemini Live)
- **Web Speech restart-storm** (`voice.ts:525-541`) — `onend→start()` bez backoffu, pętli przy utracie mic/sieci; `onerror` no-op. [M·L] ✅ do naprawy.
- **`headset.ts` cichy no-op** (labels wymagają zgody mic) + brak debounce `devicechange`. [M·L] ✅.

### Dane / krypto
- **Sync last-write-wins → utrata danych** (`sync.ts:34-73`) — pull hurtowo nadpisuje kolekcje, brak merge po `id`+`updatedAt`. [H·M] → DO DECYZJI/propozycja.
- ~~**Embeddingi pamięci ~4MB w localStorage** (`memory.ts:95`, 300×768 float) — napędza quota. [M·M]~~ ✅ **ZAMKNIĘTE (Faza A)**: `db.ts` (Dexie/IndexedDB) — kolekcje `memory`/`sentMail`/`contentPosts` (z embeddingami) przeniesione do IndexedDB; localStorage trzyma tylko odchudzony blob + drobne ustawienia. Migracja jednorazowa + hydratacja przy starcie, bezpieczny fallback do localStorage gdy brak IDB. Zdejmuje sufit ~5 MB.
- **`cipher.ts` 150k iter < `lock.ts` 210k; iter NIE zapisane w blobie** (`cipher.ts:23,43-52`) — podniesienie iteracji w przyszłości zbrickuje istniejące sejfy/backupy. [M(latentny)·M] ✅ (zapisać iter+wersję w nagłówku, wstecznie zgodnie).
- **Plaintext sekrety w `jarvis.settings.v2`** (klucze, `smtpPass`, `googleClientSecret`, tokeny) — niezaszyfrowane. [M·H] (znany tradeoff).

---

## 4. DROBNE (wybór)
- `ErrorBoundary` `restarts` nigdy nie maleje → po 2 awariach na stałe ekran „przeładuj" (`ErrorBoundary.tsx:20-29`). [L·L] ✅.
- `calculate` używa `Function()` (`tools.ts:256`) — sanityzowane, ale kruche; klasa `read` (bez zgody). [M·L] (parser zamiast Function).
- `loadVoices` zostawia `onvoiceschanged` + timer (`voice.ts:32-38`); `speakToken` nie chroni gałęzi Fish/ElevenLabs (`voice.ts:287-366`) — krótkie podwójne odtworzenie. [L·L] ✅.
- `license.ts` offline-grace pozwala używać odwołanego klucza bez sieci (świadomy tradeoff; `licenseStrict()` zamyka). [L·L].
- PIN lockout resetowalny przez czyszczenie localStorage; compare nie-stałoczasowy (`lock.ts`) — niski wpływ (offline atakujący ma i tak hash). [L·L].

**Zweryfikowane OK:** `lock.ts` PBKDF2 (210k, sól 16B, `iter` zapisany, migracja SHA-256→PBKDF2) — poprawne. `cipher.ts` IV/sól losowe per-encrypt (brak reuse), tag GCM weryfikowany. `sync.ts`/`backup.ts` walidują `Array.isArray` przy kolekcjach. Audit log ograniczony do 200.

---

## 5. Sekcja „DO MOJEJ DECYZJI" (duże/ryzykowne — NIE wdrażam bez zgody)
1. **BFF auth/SSRF/CORS** (worker A,B,C + /v1/sync token, /v1/search,/embed auth) — fail-closed auth, allowlista `/passthrough`, CORS pinning. Ryzyko: może zablokować działające wdrożenie bez `APP_TOKEN`/konfiguracji HA. *Rekomendacja: wymagać `APP_TOKEN`, dodać allowlistę — ale potrzebuję potwierdzenia, że to nie zerwie Twojego wdrożenia.*
2. **`admin.ts` krypto na numerze telefonu** (F) — przeprojektować logowanie właściciela (sekret wysokiej entropii, brak hash w bundle). Ryzyko: migracja + zmiana logowania admina.
3. **`permissions.ts` consent fail-closed dla outbound** (G) — zmiana świadomego zachowania trybu live/hands-free. *Rekomendacja: fail-closed + jawna polityka „bezgłośnej zgody".*
4. **`sync.ts` merge zamiast last-write-wins** — realna ochrona przed utratą danych między urządzeniami, ale wymaga ostrożnej implementacji merge po `id`+`updatedAt`.
5. **Wbudowane klucze API + keystore** (`vite.config.ts`, `release.yml`, `android`) — z poprzedniej rundy; publiczne repo → usunąć, prywatne → udokumentować.

---

## 6. Pomysły na rozbudowę (skrót — do sekcji TOP 5 w PROGRESS.md)
- ~~Migracja `sentMail`/`contentPosts`/embeddingów do IndexedDB (zdejmuje presję quota).~~ ✅ ZROBIONE (Faza A — `db.ts`).
- `AudioWorklet` zamiast `ScriptProcessorNode` (głos na żywo — płynność/bateria).
- Selektory store (`useSyncExternalStore`) — mniej re-renderów.
- Telemetria błędów (opcjonalna, lokalna) zamiast cichych `console.debug`.

---

*Sekcje „sales/leads" i „native+build/CI" — uzupełniane po zakończeniu agentów audytujących.*

---

## 7. SPRZEDAŻ / LEADY + sales-os (klaster 5)

### KRYTYCZNE
- **Per-lead outreach omija `autoSendEmails` i `dailyEmailCap`** (`sales-os/.../public/outreach/route.ts:79-118` → `public-outreach.ts:125-171`). Ścieżka flush honoruje limity, ale per-lead wysyła od razu (Resend/Mailgun) bez sprawdzenia zgody ani dziennego limitu → token-holder może wysłać nieograniczoną pocztę. [H·L] ✅ do naprawy (gate na `autoSendEmails` + `emailsSentToday < dailyEmailCap`).
- **Rate limiter na `X-Forwarded-For`** (`token.ts:47-60`, klucze we wszystkich 4 trasach) — nagłówek kontrolowany przez klienta → rotacja = świeży bucket; do tego per-proces (serverless: N×limit). [H·M] ✅ częściowo (klucz na sam token dla wysyłki).

### WAŻNE
- **CORS `*` na `/sync /outreach /lead-status`** (token-authed, PII + wysyłka) — token-auth łagodzi CSRF, ale `*` szeroko otwiera. [M·L] → uwaga: webview Capacitora wymaga CORS, więc zmiana ryzykowna → **rozważyć allowlistę zamiast usuwać**.
- **Token min. 6 znaków** (`token.ts:13-28`) — realne tokeny to 32 hex; podnieść próg. [M·L] ✅.
- **Overpass: 4 mirrory × 30s = ~120s zawieszenia UI** (`leads.ts:130-142`). [M·L] ✅ (timeout 12s / mniej mirrorów).
- **`sales-os/.../email/index.ts:37,67` fetch bez timeoutu** — wiszący dostawca blokuje funkcję serverless. [L·L] ✅.

### DROBNE
- Dedupe po `company.toLowerCase()` kruchy (whitespace/suffix) (`leads.ts:153,192`). [L·L].
- `mergeSnapshotLeads` name-fallback: CRM-lead o nazwie kolidującej z własnym leadem znika (omission) (`salesOs.ts:226-262`). [L·M].
- `LeadDetail.tsx:166` `window.open(lead.url)` bez guardu http/https (SalesDashboard ma `openLeadUrl`). [L·L] ✅.
- `parseElement` tnie `company` do 80, ale phone/email/website/address bez limitu (`leads.ts:94-105`). [L·L] ✅.

**OK:** wszystkie fetch w leads/leadIntel/salesOs/mailer mają `fetchTimeout`+try/catch; `publicLeadSchema` (Zod) + honeypot; `ingestLead` dedupe po email/phone; bulk send capowany 25.

---

## 8. NATYWNE POWŁOKI / BUILD / CI (klaster 6)

### KRYTYCZNE
- **Keystore + hasła w repo** (`android/keystore/jarvis.jks`, `build.gradle:36-39` `jarvis2026`) — komentarz potwierdza wcześniejszy wyciek. [H·M] → DO DECYZJI (rotacja + czyszczenie historii).
- **Windows EXE „podpisany" self-signed** z hasłem na sztywno (`windows.yml:54-64`) — zero gwarancji autentyczności, fałszywe zaufanie. [M·L] → DO DECYZJI (prawdziwy cert kosztuje).

### WAŻNE
- **CI wstrzykuje `JARVIS_*_KEY` — martwe, ale mylące** (`release.yml:46-55`, `windows.yml`, `android.yml`; `vite.config.ts` ich NIE czyta) — dziś klucze NIE trafiają do bundla (zweryfikowano `dist/`), ale plumbing jest o 1 linię od wycieku kluczy do publicznego APK; komentarze kłamią. [H(latentny)·L] ✅ do naprawy (usunąć bloki env + mylące komentarze).
- **`release.yml` publikuje podpisany APK na każdy push brancha** do rolling `latest` (`release.yml:9-16`) — bez bramki review. [M·L] → uwaga: to obecny mechanizm pobierania używany przez właściciela → **DO DECYZJI** (ograniczyć do tagów zerwie obecny flow).
- **Electron: brak `will-navigate` guard + brak `sandbox`** (`main.cjs:81-94`); prywatne IPC google/smtp/notify (l.249-320) NIE za `isTrustedIpc`. [M·L] ✅ do naprawy.
- **Electron: wildcard CORS dla WSZYSTKICH odpowiedzi** (`main.cjs:458-470`) — globalnie wyłącza same-origin. [M·M] (allowlista hostów).
- **`license-private.json`** (ECDSA private) w katalogu roboczym — gitignored, ale wrażliwy. [M·L] (przenieść offline).

### DROBNE
- `allowMixedContent: true` na Androidzie (`capacitor.config.ts:11`). [L·M].
- DevTools w produkcyjnym menu (`main.cjs:108`). [L·L] ✅ (`!app.isPackaged`).
- Skomitowany `JARVIS (1).apk` (5 MB) w repo. [L·L].
- `tsconfig` bez `noUncheckedIndexedAccess`; `electron/*.cjs` nietypowane. [L·L].

**OK:** `contextIsolation:true`+`nodeIntegration:false`; `setWindowOpenHandler` blokuje popupy; prywatne OS-IPC za `isTrustedIpc`; `launch` bez powłoki; SMTP TLS domyślne; OAuth secret nie w bundlu; pre-commit secret-scan; `dist/` bez kluczy.

---

## 9. Zaktualizowana lista „DO MOJEJ DECYZJI"
1. **BFF auth/SSRF/CORS** (worker) — fail-closed `APP_TOKEN`, allowlista `/passthrough`, auth na `/v1/search`,`/v1/embed`,`/v1/sync`. Ryzyko zerwania wdrożenia.
2. **`admin.ts`** — krypto na numerze telefonu (przeprojektować logowanie właściciela).
3. **`permissions.ts`** — consent fail-closed dla outbound (zmiana trybu live).
4. **`sync.ts`** — merge po `id`+`updatedAt` zamiast last-write-wins.
5. **Wbudowane klucze API + keystore + self-signed EXE** — publiczne repo → usunąć; prywatne → udokumentować + rotacja klucza.
6. **`release.yml` na push brancha** — ograniczyć do tagów (zerwie obecny rolling `latest`).
7. **Electron wildcard CORS** (`main.cjs:458`) — zawęzić do allowlisty hostów (ryzyko zerwania API).
8. **`sales-os` CORS `*`** na `/sync /outreach /lead-status` — allowlista (uwaga: webview).

