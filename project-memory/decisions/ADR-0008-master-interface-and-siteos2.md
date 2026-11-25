# ADR-0008: Spójna Ergonomia Wszystkich 34 Modułów Interfejsu, Motyw „Editorial Boutique” oraz `JARVIS Site OS 2.0`

Status: proposed
Data: 2026-11-25
Autor: antigravity
Zakres: `index.html`, `src/styles/index.css`, `src/App.tsx`, `src/components/*.tsx` (34 moduły okienkowe + `Conversation.tsx`), `src/lib/siteOs.ts`, `src/lib/webgen.ts`, `src/lib/tools.ts`, `site-os/*`, `tests/masterInterfaceAndSiteOs.test.ts`

## Kontekst
Kompleksowy przegląd wszystkich 77 komponentów UI aplikacji JARVIS oraz pogłębiony audyt techniczny i bezpieczeństwa modułu `JARVIS Site OS` wykazały:
1. **Brak przycisku zamykania `×` w 30 z 34 modułów okienkowych:** tylko 4 ekrany posiadały `.panel-head-row` + `.panel-close`, a wspólny komponent `Modal.tsx` renderował sam nagłówek `<h2>` bez kontrolki zamknięcia.
2. **Zbyt wąska kolumna robocza na monitorach (`max-width: 580px`):** wielokolumnowe pulpity (`WebStudio`, `SalesDashboard`, `SalesCrm`, `FinancialDashboard`, `Studio`, `MarketingWorkspace`, `Settings`, `More`, `AdminPanel`, `TaskHub`) dusiły zawartość na ekranach desktopowych i potrafiły ściskać przyciski `.btn` w wierszach `display: flex`.
3. **Wycieki kolorów trybu ciemnego i niespójna typografia liczbowa:** twardo wpisane kolory `rgba(255,255,255,...)`, `#cfcfcf`, `#bdbdbd`, `#0c1118` (w `WebStudio`, `Conversation`, `CostPanel`, `WebllmPanel`) oraz ciemna główka przełącznika `.switch::after` psuły kontrast w motywie jasnym; odczyty liczbowe mieszały `Orbitron` i `Share Tech Mono` bez `tabular-nums`.
4. **Dwie krytyczne luki P0 oraz braki ergonomiczne w `JARVIS Site OS`:**
   - **P0-1 (Ściana `60 KB` w AI):** osadzenie jednego zdjęcia WebP (`do 700 KB` base64) w `project.html` przekraczało `SAFE_EDIT_CHARS = 60_000` w `webgen.ts`, trwale blokując edycję strony przez AI.
   - **P0-2 (Bezpieczeństwo tunelu Cloudflare):** publiczny tunel udostępniał cały serwer lokalny wraz z panelem edytora `/` oraz niezabezpieczonym przed brute-force endpointem `POST /api/pair`.
   - **P1-4 / P1-5 / P2-7:** wielokrotne otwarcie projektu z `WebStudio` duplikowało wpisy (`brak upsertu po jarvisProjectId`); `iframe` w trybie podglądu blokował skrypty JS i ukrywał elementy `.reveal`; 20 wersji historii zapisywanych przez serwer nie miało interfejsu przywracania; brakowało czasu rzeczywistego (`SSE`).

## Decyzja
1. **Ujednolicenie wszystkich 34 modułów okienkowych i ergonomii desktop/mobile:**
   - Dodano `.panel-head-row` + `.panel-close` (`×`) oraz `role="dialog" aria-modal="true"` w kanonicznym `Modal.tsx` i wszystkich 29 pozostałych panelach `.sheet > .panel` (100% pokrycia strzeżone testem `tests/masterInterfaceAndSiteOs.test.ts`, przy zachowaniu pełnej zgodności z `modalMigrationGuard` i `modalA11y`).
   - Wprowadzono responsywne szerokości na ekranach `>= 760px` (`.panel-wide: 760px`, `.panel-xl: 920px`), klasę `.num-tab` (`JetBrains Mono` + `tabular-nums`), szybkie pigułki filtrowania kategorii w `More.tsx` („Centrum”), akcje Lucide w `Conversation.tsx` oraz regułę `@media (max-height: 520px)` dla orientacji poziomej telefonu.
   - Dodano motyw **`theme-editorial` („Editorial Boutique / Quiet Luxury”)** inspirowany architekturą `ImPULS Akademia` (ciepły papier `#f5f1e8`, głęboki granat `#102332`, miedź `#9e582f`, szeryfy `Fraunces`, ziarno papieru `feTurbulence` wyłączane w `html.low-power`).
2. **`JARVIS Site OS 2.0` („Autonomous Boutique Studio”):**
   - **Eliminacja ściany `60 KB` (`src/lib/siteOs.ts`):** czyste funkcje `extractDataUriAssets` i `restoreDataUriAssets` zamieniają obrazy `data:image/*` na lekkie tokeny `__JARVIS_ASSET_N__` przed wywołaniem `generateSite()` i przywracają je po odpowiedzi modelu; dodano automatyczne parowanie loopback oraz subskrypcję `SSE`.
   - **Twarda izolacja tunelu i bezpieczeństwo (`site-os/server.mjs`):** żądania spoza loopbacka (`!isLoopback`) mają dostęp wyłącznie do `GET /p/:id`, `GET /api/uploads/public/:name` oraz `POST /api/leads/:id` (`403` dla `/`, `/api/session` i `/api/pair`); dodano rate-limit `5 prób / 10 min` z rotacją kodu na `/api/pair`, weryfikację binarnych **Magic Bytes** (`PNG/JPEG/WebP`, blokada `.svg` XSS + `X-Content-Type-Options: nosniff`), `upsert` po `jarvisProjectId`, wsparcie pobierania `cloudflared` na Linuxie oraz strumień `GET /api/events` (`SSE`).
   - **Interfejs i bloki konwersji `ImPULS` (`site-os/public/*`):** bezpieczny przełącznik `Podgląd JS` (`sandbox="allow-scripts allow-forms"` bez `allow-same-origin`), wymuszenie widoczności `.reveal` w trybie edycji, starter **`Butik Editorial (ImPULS)`** z okładką introligatorską SVG, 3 interaktywne bloki konwersji (**Kompas decyzyjny 3-krokowy**, **Symulator ROI**, **Teczka i Brief A4 PDF `@media print`**), 20-wersyjna historia projektu z przywracaniem 1 kliknięciem oraz detektor realnego ucięcia mobilnego `getBoundingClientRect().right`.

## Konsekwencje
- Zero nowych zależności npm; pełna kompatybilność z ES2019 / Chrome 79 (Samsung S9).
- Trwały strażnik `tests/masterInterfaceAndSiteOs.test.ts` blokuje regresje nagłówków modali, limitu 60 KB dla grafik oraz zabezpieczeń `Site OS 2.0`.
