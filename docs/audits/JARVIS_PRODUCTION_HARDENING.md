# JARVIS — PRODUCTION HARDENING & FINAL ACCEPTANCE
## Raport wdrożenia poprawek poaudytowych i odbioru produkcyjnego na gałęzi `fix/production-integration`

- **Data wdrożenia i walidacji:** `2026-11-25` (Ubuntu 24.04 LTS VM, Node.js `v22.23.5`, Chromium + `Xvfb :99`)
- **Raport wejściowy (zachowany bez zmian):** `docs/audits/JARVIS_BRANCH_ACCEPTANCE_AUDIT.md` (kopia 1:1 z `/tmp/JARVIS_BRANCH_ACCEPTANCE_AUDIT.md`)
- **Docelowa gałąź robocza:** `fix/production-integration` (`main` nienaruszona, brak `git push`)

---

## 1. Stan gałęzi przed rozpoczęciem prac

Przed przystąpieniem do jakichkolwiek modyfikacji zweryfikowano stan repozytorium oraz zdalnych referencji `origin`:
- **Stan drzewa roboczego (`git status --porcelain=v1 -uall`):** 100% czyste (zero zmian śledzonych i nieśledzonych).
- **`feat/master-interface-polish` (lokalny i `origin`):** `b020365240e8de3e2c1b6fd5c9e2aa31fd739992` (zgodność 1:1 z raportem audytu).
- **`fix/production-integration` (lokalny i `origin`):** `4ec159489bad5be24a2116c9d7e4df5cd179b78a` (zgodność 1:1 z raportem audytu).
- **`main` (lokalny i `origin`):** `da4ee1432ccadda6c3c599292fb22f803383bb13` (nienaruszona przez cały czas trwania prac).
- **`git merge-base fix/production-integration feat/master-interface-polish`:** `4ec159489bad5be24a2116c9d7e4df5cd179b78a` (relacja liniowego potomka).

---

## 2. Wykonane scalenia

Wykonano wyłącznie bezpieczne scalenie `fast-forward` bez konfliktów i bez przepisywania historii:
```bash
git checkout fix/production-integration
git merge --ff-only feat/master-interface-polish
# Updating 4ec1594..b020365 (Fast-forward, 59 files changed, 0 conflicts)
```
Gałąź `main` nie była przełączana ani modyfikowana; nie wykonano `git push`.

---

## 3. Każda naprawiona usterka i zmienione pliki

Wszystkie poprawki wdrożono bez dodawania nowych zależności npm i podzielono na logiczne commity tematyczne na `fix/production-integration`:

### Commit 1 (`cfe208e`) — `fix(site-os): isolate /p/:id with CSP sandbox, harden /api/session, cap SSE & separate LAN/tunnel`
| ID audytu | Priorytet | Zmienione pliki | Zakres wdrożonej naprawy |
|---|---|---|---|
| **F-01** | **P1 (Krytyczne bezpieczeństwo)** | `site-os/server.mjs`, `site-os/public/app.js`, `src/lib/siteOs.ts`, `electron/local-siteos.cjs`, `site-os/scripts/smoke.mjs`, `tests/siteOsHardening.test.ts` | 1) Na `GET /p/:projectId` dodano nagłówek `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups; frame-ancestors *` (bez `allow-same-origin`) oraz `Referrer-Policy: no-referrer`. 2) W `corsHeaders()` usunięto globalną akceptację `Origin: null`, ograniczając ją wyłącznie do publicznego formularza leadowego (`POST/OPTIONS /api/leads/:projectId`). 3) Na `GET /api/session` wdrożono wielosygnałową weryfikację `isTrustedSessionRequest(req)` (bezpośredni loopback, brak nagłówków proxy, anty-DNS-rebinding `Host`, wymagany niestandardowy nagłówek `X-SiteOS-Client: studio\|jarvis\|cli`, odrzucenie `Origin: null` i cross-origin, weryfikacja `Sec-Fetch-Site`/`Mode`/`Dest`, blokada `Referer: /p/*`). 4) Dla panelu `/` dodano `CSP: frame-ancestors 'none'` (ochrona przed clickjackingiem), w `app.js` użyto `textContent` dla `.project-thumb` i `noopener,noreferrer` dla podglądu, a w `electron/local-siteos.cjs` udostępniono bezpieczny odczyt lokalnego tokenu po zaufanym IPC. |
| **F-03** | **P2 (Zasoby / SSE)** | `site-os/server.mjs`, `tests/siteOsHardening.test.ts` | Wprowadzono limit `MAX_SSE_CLIENTS` (domyślnie `16`, konfigurowalny przez `SITE_OS_MAX_SSE_CLIENTS`), odmowę `429 Too Many Requests` (`Retry-After: 5`) po przekroczeniu puli, aktywne odśmiecanie martwych gniazd oraz idempotentne czyszczenie timerów `keepAlive` na `req.close`, `res.close`, `res.error`, błędach zapisu i `SIGINT`/`SIGTERM`. |
| **F-04** | **P2 (Integralność HTML)** | `src/lib/siteOs.ts`, `tests/siteOsHardening.test.ts`, `tests/masterInterfaceAndSiteOs.test.ts` | Przebudowano `extractDataUriAssets` na dwuetapowy, liniowy matcher zgodny z ES2019 (Chrome 79, bez `lookbehind`): wartości ujęte w cudzysłowy `"..."` i `'...'` obsługują wielowierszowy base64, natomiast wartości nieujęte w cudzysłów (`src=data:image/... alt="x"`, `=/>`) oraz CSS `url(...)` nie dopuszczają białych znaków i zachowują sąsiednie atrybuty HTML oraz samozamykający ukośnik `/>`. |
| **F-05** | **P2 (Sieć LAN / Parowanie)** | `site-os/server.mjs`, `src/lib/siteOs.ts`, `tests/siteOsHardening.test.ts` | Rozdzielono trzy strefy zaufania: `isDirectLoopback`, `isDirectLanRequest` (ścisłe RFC1918 `10/8`, `172.16/12`, `192.168/16` + IPv6 ULA/link-local bez nagłówków proxy) oraz `isProxiedOrTunnelRequest` (13 nagłówków proxy/Cloudflare). Przy `SITE_OS_HOST=0.0.0.0` telefon w Wi-Fi LAN może wywołać `/api/health` (bez wycieku `tunnelUrl`), sparować się jednorazowym kodem przez zserializowane mutexem `pairQueue` `/api/pair` (porównanie `timingSafeEqual`, rotacja kodu i zwrot osiągalnego `http://<lanIp>:<port>` zamiast `0.0.0.0`) i korzystać z API z tokenem `Bearer`, podczas gdy `/`, `/api/session` i `/api/tunnel*` pozostają w LAN zablokowane (`403`). |
| **F-10** | **P3 (Higiena plików)** | `site-os/public/styles.css` | Usunięto nadmiarową pustą linię na końcu pliku (`git diff --check` zwraca kod `0`). |

### Commit 2 (`a2d306e`) — `fix(ui,a11y): unify focus-trap & ARIA across all 34 sheets, fix toast/sheet overlap & light theme input`
| ID audytu | Priorytet | Zmienione pliki | Zakres wdrożonej naprawy |
|---|---|---|---|
| **F-02** | **P2 (UI / Warstwy)** | `src/styles/index.css`, `src/components/Modal.tsx`, `src/lib/toast.ts`, `tests/sheetFocusTrapAndToast.test.ts` | Zachowano pełną widoczność `.toast` (`z-index: 1000`, `role="status"`, `aria-live="polite"`), przenosząc go poniżej `.topbar` w widoku głównym (`top: 58px/62px`) oraz dokując nad stopką (`bottom: calc(74px + var(--sab))`) gdy otwarty jest dowolny arkusz (`body.sheet-open .toast`, utrzymywane licznikiem referencji w `useModalFocusTrap`). Ostrzeżenie `⚠ Słowo-klucz „Jarvis” [Sprawdź]` nie nakłada się już na tytuł ani przycisk `×` na żadnej rozdzielczości (`360×800`, `390×844`, `844×390`, `1440×900`). |
| **F-08** | **P2 (Motyw jasny)** | `src/styles/index.css`, `tests/sheetFocusTrapAndToast.test.ts` | Dodano `color-scheme: light` oraz jawne style `body.theme-light .onboard input` (`background: #ffffff`, `color: #0f172a`, wyraźne obramowanie i placeholder `#64748b`; analogicznie dla `body.theme-editorial .onboard input`). |
| **F-09** | **P2 (Dostępność modalów)** | `src/components/Modal.tsx` + 33 pliki `.sheet` w `src/components/*.tsx`, `tests/sheetFocusTrapAndToast.test.ts` | Wyeksportowano z `Modal.tsx` jedną wspólną implementację `useModalFocusTrap()` i podpięto ją do wszystkich 33 starszych arkuszy `.sheet` (razem 34/34 dialogów): zapis `prevFocus` przed przeniesieniem fokusu na otwarciu, pełna pułapka `Tab`/`Shift+Tab` (w tym przechwyt na poziomie `document` dla najwyższego otwartego arkusza), przywrócenie fokusu na element wywołujący po zamknięciu, obsługa `Escape` we wszystkich 34 oknach (w tym fail-safe odmowa `finish(false, false)` w `PermissionDialog.tsx`) oraz kompletne `role="dialog"`, `aria-modal="true"` i `aria-label` na każdym oknie. |

---

## 4. Opis poprawy bezpieczeństwa (Defense-in-Depth)

Zamknięcie krytycznego zagrożenia **P1 (`F-01`)** oparto na **pięciu niezależnych warstwach obrony**, dzięki czemu pojedynczy błąd konfiguracji lub specyfika przeglądarki nie prowadzi do przejęcia `runtime.token`:
1. **Piaskownica dokumentu `GET /p/:projectId` (`CSP: sandbox`):** Brak flagi `allow-same-origin` wymusza w silniku przeglądarki unikalny, nieprzezroczysty `window.origin === "null"`, blokując dostęp do `localStorage`/`indexedDB`/`cookie` panelu oraz oznaczając każde wywołanie sieciowe nagłówkami `Origin: null` i `Sec-Fetch-Site: cross-site`. Jednocześnie zachowano `allow-scripts allow-forms allow-modals allow-popups`, więc interaktywne sekcje (kompas, kalkulatory ROI, przełącznik motywu, druk A4 `window.print()`) i formularze leadowe działają bez regresji.
2. **Zawężenie polityki CORS:** Usunięto `Origin: null` z ogólnych odpowiedzi API; `Access-Control-Allow-Origin: null` jest zwracany wyłącznie dla publicznego zapisu formularza kontaktowego (`POST / OPTIONS /api/leads/:projectId`).
3. **Wymóg niestandardowego nagłówka `X-SiteOS-Client` na `GET /api/session`:** Uniemożliwia odczyt sesji prostymi żądaniami bez preflightu (`<script src>`, `<iframe src>`, `<img>`, `window.open`, `fetch(..., { mode: "no-cors" })`) i wymusza w przeglądarce wysłanie prawdziwego, niemodyfikowalnego z JS nagłówka `Origin`.
4. **Weryfikacja `Origin`, `Referer`, `Host` i metadanych `Sec-Fetch-*`:** Serwer odrzuca (`403`) każde żądanie z `Origin: null`, obcym `Origin`, `Host` spoza `localhost/127.0.0.1/[::1]` (ochrona przed DNS rebinding), `Sec-Fetch-Mode` innym niż `cors`/`same-origin`, `Sec-Fetch-Dest` innym niż `empty` lub `Referer` wskazującym na `/p/*`.
5. **Stały czas porównania sekretów (`timingSafeEqual`) i serializacja parowania (`pairQueue`):** Porównania `runtime.token` oraz 6-cyfrowego `pairingCode` są odporne na ataki czasowe, a kolejka `pairQueue` eliminuje okno wyścigu przy równoległych połączeniach TCP do `/api/pair`.

---

## 5. Testy wykonane i ich rzeczywiste wyniki

Wszystkie poniższe testy zostały faktycznie uruchomione na gałęzi `fix/production-integration` po wdrożeniu poprawek:

| Test / Polecenie | Status | Rzeczywisty wynik |
|---|---|---|
| `node scripts/secret-scan.mjs --all` | **PASS (`0`)** | `✅ Skan sekretów: czysto.` |
| `npm run lint` (`eslint .`) | **PASS (`0`)** | `0` błędów, `0` ostrzeżeń w całym repozytorium |
| `npx tsc -b` | **PASS (`0`)** | `0` błędów kompilacji TypeScript |
| `npx vite build` | **PASS (`0`)** | Zbudowano w `17.91s` (`2 442` modułów, `index.js` `378.47 kB` gzip) |
| `npx vitest run --reporter=dot` (z `DISPLAY=:99`) | **PASS (`0`)** | **`372/372` plików testowych**, **`3 125/3 125` testów zaliczonych** (`0` błędów, `0` pominiętych) |
| `tests/siteOsHardening.test.ts` (HTTP + LAN + SSE + **prawdziwy Chromium CDP**) | **PASS (`0`)** | `7/7` testów: blokada `10` wektorów ataku na `/api/session` (`403`), limit `MAX_SSE_CLIENTS` (`429` + zwolnienie slotu po `abort()`), parowanie po żywym gnieździe RFC1918 (`192.168.0.2` przy `SITE_OS_HOST=0.0.0.0`) oraz żywy test w Chromium potwierdzający `window.origin === "null"`, blokadę `localStorage` i `fetch('/api/session')` na `/p/:id` przy zachowaniu działania formularza leadowego (`201`) i panelu edytora |
| `tests/sheetFocusTrapAndToast.test.ts` (JSDOM + skan 34 dialogów) | **PASS (`0`)** | `4/4` testy: `34/34` dialogi z `useModalFocusTrap`, `useEscape`, `role="dialog"`, `aria-modal="true"`, `aria-label`; zawijanie `Tab`/`Shift+Tab`, `body.sheet-open` i przywracanie fokusu do przycisku wywołującego |
| Żywy audyt Chromium CDP UI i klawiatury (`360×800`, `390×844`, `844×390`, `1440×900`) | **PASS (`0`)** | Na wszystkich 4 rozdzielczościach: `docOverflowX = 0`, `toastVisible = true`, `toastOverlapsHeader = false`, `toastOverlapsCloseBtn = false`, fizyczne kliknięcie myszą w środek `×` zamyka arkusz (`closedByRealClickOnX = true`); `65× Tab` i `15× Shift+Tab` nie wyprowadzają fokusu poza `More.tsx` (`escapedFwd = false`, `escapedBwd = false`), a `Escape` zamyka okno i przywraca fokus na przycisk paska górnego (`restored = true`) |
| `npm run tools:verify` | **PASS (`0`)** | `10/10` aktywnych adapterów workspace OK (`postgres: null` — brak `psql`) |
| `npm --prefix site-os run smoke` | **PASS (`0`)** | Potwierdzona blokada gołego `/api/session`, `Origin: null` i cross-origin (`403`), izolacja tunelu (`403`), Magic Bytes (`415`), piaskownica CSP na `/p/:id`, upsert projektów, kolejka komend i zapis leadów |
| `npm run test:e2e:xvfb` | **PASS (`0`)** | **`10/10` PASS** na żywym `Xvfb :99` (`0` błędów CORS, `0` wyjątków JS) |
| `npm run memory:verify` | **PASS (`0`)** | Spójność wygenerowanego stanu `CURRENT_STATE.*` oraz `10/10` zdarzeń w dzienniku agentów |
| `git diff --check` | **PASS (`0`)** | Zero błędów białych znaków i końców plików |

---

## 6. Testy niewykonane i powody (ograniczenia środowiska VM)

Zgodnie z zasadami rzetelności nie oznaczono jako wykonane testów wymagających fizycznego sprzętu poza maszyną wirtualną:
1. **Natywna binarka Electron (`electron .` / AppImage / `.deb`):** Niezainstalowana w środowisku VM (brak sesji graficznej z pękiem kluczy systemowych `safeStorage`, `desktopCapturer` Wayland oraz globalnego skrótu OS `Ctrl+Alt+X`). Logikę `electron/local-siteos.cjs`, `workspace-tools.cjs`, `mcp-stdio.cjs` i `public-page.cjs` zweryfikowano testami integracyjnymi w Node.js.
2. **Fizyczny mikrofon, głośniki i lokalne GPU (`Ollama` / `Whisper`):** Zweryfikowano routing AutoCore i fallbacki programowe; test rzeczywistego strumienia audio i lokalnych modeli GPU wymaga fizycznego Ubuntu właściciela.
3. **Publiczny tunel internetowy `cloudflared` (`*.trycloudflare.com`):** Izolację tunelu przetestowano lokalnie pełnym zestawem nagłówków proxy Cloudflare bez otwierania publicznego endpointu w Internecie.
4. **Fizyczne urządzenie Android (`APK`):** Kod natywny `android/` nie uległ zmianie; zweryfikowano responsywność mobilną (`360×800`, `390×844`, `844×390`) i kontrakt ES2019 (`tests/s9RegexGuard.test.ts`).

---

## 7. Porównanie stanu przed i po utwardzeniu

| Obszar | Przed (`b020365` — `APPROVED WITH CONDITIONS`) | Po utwardzeniu (`fix/production-integration`) |
|---|---|---|
| Pełnoekranowy podgląd `GET /p/:projectId` (`F-01`, **P1**) | `CSP: frame-ancestors *` (wspólny origin z `GET /api/session`, możliwy odczyt `runtime.token` lokalnie) | **`CSP: sandbox allow-scripts allow-forms allow-modals allow-popups; frame-ancestors *`** (`window.origin === "null"`, brak dostępu do storage i sesji, potwierdzone w Chromium) |
| Ochrona `GET /api/session` (`F-01`, **P1**) | Sprawdzenie wyłącznie `isLoopback(req)` i akceptacja `Origin: null` w CORS | **6-warstwowa weryfikacja** (loopback + `Host` + `X-SiteOS-Client` + blokada `Origin: null` / cross-origin + `Sec-Fetch-*` + blokada `Referer: /p/*`) |
| `extractDataUriAssets` (`F-04`) | Pochłanianie spacji i kolejnego atrybutu przy `src=data:image/... alt="x"` | Zachowuje sąsiednie atrybuty HTML, `/>`, cudzysłowy `"..."`/`'...'` i `url(...)` bez utraty danych |
| Strumień SSE `/api/events` (`F-03`) | Brak limitu klientów, ryzyko pozostawienia timerów | Twardy limit `MAX_SSE_CLIENTS = 16` (`429` + `Retry-After: 5`) i pełne sprzątanie zasobów przy rozłączeniu |
| Sieć LAN Wi-Fi vs Tunel (`F-05`) | `/api/pair` zablokowane w LAN (`403`), okno wyścigu przy wolnych gniazdach, zwrot `0.0.0.0` | Rozdział `Loopback` / `LAN RFC1918` / `Proxy-Tunel`, serializacja `pairQueue`, `timingSafeEqual`, zwrot osiągalnego URL LAN przy zachowaniu blokady `403` dla `/`, `/api/session` i `/api/tunnel*` |
| Kolizja `.toast` z `.sheet` (`F-02`) | Dymek `Słowo-klucz „Jarvis”` zasłaniał tytuł (`360px`) i przycisk `×` (`844×390`) | Widoczny dymek dokowany nad stopką (`body.sheet-open .toast`), `0` kolizji z nagłówkiem i `×` na wszystkich rozdzielczościach |
| `body.theme-light .onboard input` (`F-08`) | Zbyt niski kontrast podczas przełączania na jasny motyw | Czyste `#ffffff` tło, `#0f172a` tekst i `color-scheme: light` |
| Dostępność 34 okien dialogowych (`F-09`) | `Tab` uciekał w tło w 29 oknach `.sheet`, brak `aria-label` w 18 oknach, brak `Escape` w `PermissionDialog` | Wspólny `useModalFocusTrap` z `Modal.tsx`, `useEscape`, `role="dialog"`, `aria-modal="true"` i `aria-label` w **34/34** oknach + przywracanie fokusu |
| `git diff --check` (`F-10`) | Błąd końcowej pustej linii w `site-os/public/styles.css:748` | **Czysto (kod wyjścia `0`)** |
| Zestaw testów automatycznych Vitest | `370` plików / `3 114` testów | **`372` pliki / `3 125` testów (`100% PASS`)** |

---

## 8. Znane ograniczenia

1. **Sam interfejs edytora `Site OS 2.0` jest narzędziem desktopowym (`>= 900 px`):** Na ekranie smartfona (`390 px`) trzypanelowy warsztat edytora wymaga poziomego przewijania, podczas gdy same **witryny generowane dla klientów (`/p/:id`)** oraz podgląd kanwy `Telefon 360 px` w edytorze są w pełni responsywne.
2. **Rozmiar dokumentu edytowanego przez AI (`SAFE_EDIT_CHARS = 60 000`):** Osadzone obrazy `data:image/...` są już automatycznie wycinane przed wysyłką do modelu, jednak pojedynczy dokument przekraczający `60 KB` czystego kodu HTML/CSS/JS (bez obrazów) nadal podlega limitowi ochronnemu `webgen.ts`.

---

## 9. Pozostałe ryzyka (poza zakresem bieżącej iteracji, do ewolucyjnego utrzymania)

1. **Wcześniejsze zagadnienia warstwy natywnej Electron (niezmieniane na tej gałęzi, opisane w sekcji 5 audytu bazowego):** uzupełnienie strażnika `isTrustedIpc(event)` na 3 pomocniczych kanałach statusowych w `electron/main.cjs`, zaszyfrowanie `google-tokens.json` przez `safeStorage` oraz opcjonalne osadzenie systemowego sandboxa procesów (`bwrap`/`firejail`) dla poleceń `node`/`npx` zatwierdzanych ręcznie w `workspace-tools.cjs`.
2. **Weryfikacja sumy kontrolnej `.sha256` przy automatycznym pobieraniu `cloudflared` na Linuxie (`F-07` P2):** obecnie pobieranie odbywa się po HTTPS z oficjalnego GitHub Releases Cloudflare z kontrolą rozmiaru `>= 5 MB`; w kolejnym wydaniu warto dodać weryfikację pliku skrótu SHA-256.

---

## 10. Ostateczna rekomendacja dotycząca promocji na `main`

Wszystkie wykryte usterki `P1` (w szczególności `F-01` — izolacja podglądu `/p/:projectId` oraz wielowarstwowa ochrona `/api/session`) oraz zaplanowane poprawki `P2`/`P3` (`F-02`, `F-03`, `F-04`, `F-05`, `F-08`, `F-09`, `F-10`) zostały wdrożone, objęte testami regresyjnymi i potwierdzone na żywej przeglądarce Chromium oraz żywym serwerze X11 (`Xvfb :99`). Gałąź `fix/production-integration` jest czysta, spójna i po standardowym 10-minutowym odbiorze sprzętowym właściciela na fizycznym Ubuntu gotowa do promocji na `main`.

**Werdykt końcowy:** **`READY FOR MAIN`**
