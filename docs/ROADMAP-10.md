# JARVIS → 10/10 — ROADMAP doskonałości (audyt + plan)

Audyt 10 osi „ship-grade". Wynik bazowy ~**6.3/10** (średnia). Cel: każda oś = 10.
Stan: FAZA 0 (audyt) gotowa · FAZA 1 (wydajność) wdrożona.

| # | Oś | Teraz | Priorytet |
|---|---|---|---|
| 1 | Onboarding & aktywacja | 7 | śr |
| 2 | Niezawodność | 7 | śr |
| 3 | Wydajność | **8** (było 6) | wys ✅ częściowo |
| 4 | UX / czytelność | 8 | niski-śr |
| 5 | Dostępność (a11y) | 4 | **WYS** |
| 6 | i18n (EN) | 2 | **WYS** |
| 7 | Bezpieczeństwo | 7 | śr (decyzje) |
| 8 | Sync / multi-device | 7 | śr |
| 9 | Monetyzacja wbudowana | 6 | śr-wys |
| 10 | Jakość / utrzymanie | 7 | śr |

---

## 1. Onboarding & aktywacja — 7/10
**Dobre:** „Wklej dowolny klucz" (detectProvider + Tavily), nudge „brak mózgu" na ekranie startowym, ✓/🔑 gotowości dostawcy, podpowiedzi zależne od pory dnia.
**Słabe:** brak prowadzonego flow „od zera do wow w 60 s"; brak ekranu „samotest" jednym kliknięciem.
**Plan:** mini-kreator (3 kroki: klucz → test → pierwsze pytanie), przycisk „Sprawdź wszystko".

## 2. Niezawodność — 7/10
**Dobre:** graceful-degradation szeroko (research/leady/głos), `errorLog`, Strażnik, fix research-bez-CORS.
**Słabe:** telemetria błędów nie jest wyeksponowana; „samotest" ukryty w diagnostyce.
**Plan:** widoczny ekran „Stan i samotest" + licznik błędów z `errorLog`.

## 3. Wydajność — 8/10 (było 6) ✅ FAZA 1
**Zrobione:** lazy-split ciężkich paneli modalnych (Settings 2600 linii, SalesDashboard, Journal, Projects, More, Help, Panels, ChatHistory, HeadsetMode). **Główny chunk 742→540 kB (gzip 257→194, −27%).**
**Słabe (dalej):** główny chunk wciąż >500 kB; pdf.worker 1.37 MB (osobny, lazy — OK).
**Plan:** dalsze cięcie rdzenia (providers/tools), `manualChunks` dla vendorów.

## 4. UX / czytelność — 8/10
**Dobre:** wyszukiwarka-skok w Ustawieniach, spis zakładek, JEDEN wybór silnika głosu, ikonki cech modeli, inteligentne przewijanie czatu.
**Słabe:** najdłuższe ściany tekstu (instrukcja hasła Google), część integracji bez kotwic.
**Plan:** skrócić mikrocopy, dokończyć kotwice wyszukiwarki.

## 5. Dostępność (a11y) — 4/10 — **PRIORYTET**
**Mierzone:** 19× `aria-`, 2× `role=`, **0× `:focus-visible`** w CSS.
**Słabe:** brak widocznego focusu klawiatury, mało ról/etykiet, kontrast niesprawdzony.
**Plan (szybkie, niskie ryzyko):** globalne `:focus-visible` (pierścień focusu), `aria-label` na ikon-przyciskach, `role`/`aria-modal` na panelach, `aria-live` na statusach.

## 6. i18n (EN) — 2/10 — **PRIORYTET (największy lift)**
**Mierzone:** brak warstwy i18n UI; stringi zaszyte po polsku. `langs.ts`/`translate.ts` dotyczą funkcji TŁUMACZA, nie interfejsu.
**Plan:** lekka warstwa i18n (`t(key)` + słowniki PL/EN + przełącznik języka, autodetekcja `navigator.language`). Start: nawigacja/onboarding/ustawienia; reszta etapami. Zasada: nowy kod bez zaszytych stringów.

## 7. Bezpieczeństwo — 7/10
**Dobre:** BFF z anty-SSRF (allowlista hostów + metadane chmury), token aplikacji (opt-in fail-closed), sekrety szyfrowane, bramki zgód, noCRLF.
**DO DECYZJI (właściciel):** (a) hash telefonu admina → PBKDF2+sól; (b) pełna allowlista `/passthrough`. **Nie zmieniam na ślepo.**
**Plan:** przygotować PR-y warunkowe + krótką notkę decyzyjną.

## 8. Sync / multi-device — 7/10
**Dobre:** `sync.ts` (`pushSync`/`pullSync`/`mergeById` po `updatedAt`), `backup.ts`, naprawiony wcześniej data-loss przy hydratacji.
**Słabe:** brak twardego audytu konfliktów/krawędzi linijka po linijce; brak wskaźnika stanu sync.
**Plan:** audyt `mergeById` + testy konfliktów, wskaźnik „zsynchronizowano".

## 9. Monetyzacja wbudowana — 6/10
**Dobre:** `LicenseGate`, BYOK (klient wpisuje klucz), white-label (`brandName`).
**Słabe:** BYOK nie jest „opakowany" jako model; brak dopiętego wertykału sprzedażowego end-to-end.
**Plan:** ekran „Tryb BYOK", haczyki white-label w UI, dopięcie ścieżki „asystent sprzedaży dla mikrofirm".

## 10. Jakość / utrzymanie — 7/10
**Dobre:** 1292 testy jednostkowe, pełna bramka (tsc/lint/vitest/build/worker) na każdym commicie.
**Słabe:** brak E2E krytycznych ścieżek; brak `docs/ARCHITECTURE.md`; brak metryki pokrycia.
**Plan:** `ARCHITECTURE.md` (mapa modułów + przepływ tury), kilka testów E2E (smoke), włączyć `--coverage`.

---

## Kolejność egzekucji (autonomiczna)
1. ✅ **FAZA 1 — Wydajność** (lazy-split) — zrobione.
2. **FAZA 2 — a11y** (focus-visible + ARIA) — szybkie, wysoki zysk.
3. **FAZA 3 — i18n scaffold + EN starter** — odblokowuje rynek.
4. **FAZA 4 — Niezawodność** (ekran samotest + telemetria).
5. **FAZA 5 — Onboarding 60 s**.
6. **FAZA 6 — docs/ARCHITECTURE.md** (+ coverage).
7. **FAZA 7 — Sync audit** (+ testy konfliktów).
8. **FAZA 8 — Monetyzacja/wertykał**.
9. **DO DECYZJI — Bezpieczeństwo rezydualne** (czeka na decyzję właściciela).
