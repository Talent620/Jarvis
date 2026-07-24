# JARVIS · AI Assistant 2.0

> 🚨 **OSTRZEŻENIE BEZPIECZEŃSTWA:** Klucz OpenRouter `sk-or-v1-…` **wyciekł w buildach ≤ 55**
> (był wpiekany do bundla). **Zrotuj go ręcznie** na https://openrouter.ai/keys — tego nie da się
> cofnąć z poziomu kodu. Szczegóły i pełna lista kluczy do rotacji: **[SECURITY.md](./SECURITY.md)**.
> Od teraz klucze trafiają wyłącznie do **BFF** (`proxy/`), nie do aplikacji.


Agentowy asystent głosowy i tekstowy w stylu HUD, napędzany **Claude Opus 4.8**.
Aplikacja webowa (React + Vite) opakowana w Androida przez **Capacitor** — następca
oryginalnego `JARVIS.apk`, tym razem z pełnym kodem źródłowym, który możesz dowolnie
modyfikować i z którego zbudujesz nowy APK.

## Desktop: Windows i Ubuntu

JARVIS desktop działa na Windows oraz Ubuntu. Dla Ubuntu dostępne są dwa warianty:

- `JARVIS.deb` — zwykła instalacja w Ubuntu/Debian.
- `JARVIS.AppImage` — pojedynczy, przenośny plik uruchamiany bez instalacji.

Tworzenie pakietów lokalnie: `npm run desktop:ubuntu`. GitHub Actions publikuje oba
pliki przy aktualizacji gałęzi `main`.

## Co potrafi

- **Wybór modelu z wielu dostawców** — Claude (Opus 4.8), Google Gemini, Groq,
  OpenRouter (35+ modeli), NVIDIA NIM, GitHub Models. Tryb **auto** sam dobiera
  najlepszy dostępny model na podstawie wpisanych kluczy.
- **Agentowy mózg** — tool-use w każdym dostawcy (function calling): realnie
  wykonuje zadania, nie tylko odpowiada. Claude dodatkowo z myśleniem adaptacyjnym
  i serwerowym wyszukiwaniem w sieci.
- **Pamięć** — zapamiętuje trwałe fakty i preferencje o użytkowniku (`remember_fact`).
- **Wiedza w czasie rzeczywistym** — wyszukiwanie w sieci: tryb **research z cytatami**
  (Tavily, niezależny od dostawcy) + serwerowe `web_search` Claude. Źródła [1],[2] pod odpowiedzią.
- **Uprawnienia + audyt + cofanie** — akcje (dzwonienie, SMS, smart home, zapisy) wymagają
  zgody; dziennik akcji (zakładka „Audyt") z możliwością cofnięcia dodań.
- **Widoczne kroki agenta** — orb pokazuje, co JARVIS właśnie robi (np. „⚙ web_research…").
- **Głos** — ciągłe nasłuchiwanie słowa-klucza „Jarvis", rozpoznawanie mowy (STT)
  i synteza mowy (TTS) z głosem dobranym pod styl JARVIS-a; opcjonalnie premium
  głos przez ElevenLabs.
- **Sterowanie urządzeniem i usługami** — otwieranie aplikacji (Spotify, YouTube,
  Mapy, Gmail, WhatsApp, Allegro/OLX…), dzwonienie, SMS, nawigacja.
- **Rozmowa na żywo (Gemini Live)** — pełny dupleks audio↔audio przez WebSocket:
  mówisz i słyszysz odpowiedź w czasie rzeczywistym, z przerywaniem. Przycisk ☎.
- **Kalendarz i kontakty telefonu** — JARVIS dodaje/odczytuje wydarzenia w kalendarzu
  urządzenia oraz dzwoni/wysyła SMS do kontaktów po imieniu (bez OAuth/backendu).
- **Skróty i udostępnianie** — długie przytrzymanie ikony = szybkie akcje (raport,
  pogoda, zadania); JARVIS pojawia się też w panelu „Udostępnij" Androida.
- **Wizja / aparat** — zrób lub wybierz zdjęcie i zapytaj „co to jest?". JARVIS
  analizuje obraz (Claude / Gemini / modele vision). 📷 obok pola tekstowego.
- **Natywne powiadomienia** — przypomnienia odpalają się jako powiadomienia
  systemowe Androida (Capacitor Local Notifications), nawet po zamknięciu okna.
- **Smart home** — sterowanie urządzeniami przez Home Assistant (włącz/wyłącz/przełącz).
- **Raport poranny** — jednym poleceniem podsumowanie: pora dnia, pogoda na żywo,
  dzisiejsze wydarzenia, aktywne zadania i przypomnienia (jak chief-of-staff).
- **Pogoda na żywo** — Open-Meteo (bez klucza, darmowe) wg lokalizacji lub miasta.
- **Barge-in** — włączenie mikrofonu/słowo-klucz natychmiast przerywa mówienie JARVIS-a.
- **Projekty / Workspace'y** (📁) — trwały kontekst: własne instrukcje, przypięte
  **dokumenty (PDF/tekst)** i pamięć per projekt; JARVIS używa ich jako kontekstu.
- **Historia rozmów** — wiele zapisanych rozmów (🕘): otwieraj, kontynuuj, usuwaj.
- **Głos JARVIS (Iron Man)** — jeden przycisk w ⚙ dobiera najbliższe legalnie brzmienie
  (niski brytyjski męski; z kluczem ElevenLabs stockowy głos „Daniel").
- **Płynne odpowiedzi** — efekt „pisania na żywo" + „nowa rozmowa".
- **Szybkie akcje** — podpowiadane komendy na start.
- **Przejrzysty UI mobilny** — panele jako bottom-sheet z przewijaną treścią i stałą
  stopką (nic się nie ucina, bezpieczne marginesy pod notch/gesty).
- **Produktywność** — zadania, notatki, przypomnienia, kalendarz, lista zakupów.
- **Pulpit Sprzedaży / CRM** (📈) — znajdowanie leadów (OpenStreetMap, bez klucza),
  teczka klienta z analizą i skryptem rozmowy, statusy, prognoza lejka, **wyszukiwarka
  leadów**, znacznik „✉ wysłano", import/eksport CSV, „Plan na dziś" z follow-upami.
- **Wysyłka e-maili z aplikacji** — oferta jednym kliknięciem („Napisz i wyślij"):
  na Windows przez **SMTP** (hasło aplikacji), na telefonie przez **przekaźnik SMTP
  w backendzie** (bez Google OAuth) lub **Gmail OAuth**. **Skrzynka wysłanych** (komu/
  kiedy, licznik „dziś", CSV, czyszczenie), automatyczny **podpis**, **test poczty**
  i **sprawdzenie połączenia**.
- **Gmail (przez backend Google)** — czytanie skrótów i **pełnej treści**, wysyłka oraz
  **odpowiedź w wątku** (`gmail_search` / `gmail_read` / `gmail_send` / `gmail_reply`).
- **Kalendarz Google** — nadchodzące wydarzenia, **odczyt konkretnego dnia**
  („co mam dziś/jutro") i dodawanie zapisów (`gcal_list` / `gcal_day` / `gcal_add`).
  Poranny briefing dorzuca dzisiejszy kalendarz Google i nieprzeczytane maile.
- **Maszynka do kontentu** (📱) — gotowe posty na Instagram/Facebook/TikTok/LinkedIn
  (ton, marka), Kopiuj / Udostępnij / Inna wersja, **historia postów**.
- **Generator reklam** (📢) — gotowe zestawy reklam Google Ads (nagłówki/opisy/słowa
  kluczowe/budżet) i Meta (tekst/CTA/kreacje/grupa docelowa). Bez API — kopiujesz do
  panelu Google/Meta. *(Integracja przez API — czytanie wyników i zarządzanie kampaniami
  — to planowane Fazy 1–2.)*

## Konfiguracja

Po pierwszym uruchomieniu wejdź w **⚙ Ustawienia**, wybierz **dostawcę** (lub zostaw
„auto") i wpisz **przynajmniej jeden klucz API**:

| Dostawca | Gdzie wziąć klucz |
|---|---|
| Claude (Anthropic) | https://platform.claude.com |
| Google Gemini | https://aistudio.google.com |
| Groq | https://console.groq.com |
| OpenRouter | https://openrouter.ai |
| NVIDIA NIM | https://build.nvidia.com |
| GitHub Models | https://github.com/marketplace/models |

Klucze są przechowywane **lokalnie na urządzeniu** (localStorage). Tryb „auto"
wybiera dostawcę z najwyższym priorytetem, dla którego podano klucz.

> 🧠 **Tryb lokalny (prywatny)?** JARVIS umie myśleć dwiema prędkościami — szybki model
> lokalny (**Refleks**, Ollama) na co dzień i chmura (**Kora**) tylko przy trudnych zadaniach.
> Konfiguracja i wszystkie przełączniki: **[docs/REFLEKS_KORA.md](docs/REFLEKS_KORA.md)**.

> ⚠️ **Bezpieczeństwo:** w wersji bez backendu klucze żyją w aplikacji klienckiej.
> To wygodne do użytku osobistego. Do dystrybucji użyj **backend-proxy** (katalog
> `proxy/`) — przejmuje też ruch dla dostawców blokujących CORS (NVIDIA, GitHub Models)
> i może chować klucze po stronie serwera. Nigdy nie wklejaj kluczy do repozytorium
> ani do publicznych miejsc; jeśli to zrobisz — natychmiast je zresetuj.

## Uruchomienie lokalne (web)

```bash
npm install
npm run dev
```

Otwórz adres podany przez Vite (domyślnie http://localhost:5173).

> Rozpoznawanie mowy działa w przeglądarkach opartych na Chromium oraz w WebView
> Androida. TTS działa wszędzie tam, gdzie dostępne jest Web Speech API.

## Budowa APK (Android)

Projekt zawiera już wygenerowaną platformę Android (`android/`) z ustawionymi
uprawnieniami (internet + mikrofon).

### Najprościej — w chmurze GitHub (bez instalowania niczego)

W repo jest workflow `.github/workflows/android.yml`. Po każdym pushu (albo ręcznie
przez **Actions → Build Android APK → Run workflow**) GitHub zbuduje APK i wystawi
go w sekcji **Artifacts** (`jarvis-debug-apk`). Pobierz i zainstaluj.

### Lokalnie (Android Studio)

```bash
npm run build
npx cap sync android
npx cap open android   # Build → Build APK(s)
```

Gotowy plik: `android/app/build/outputs/apk/debug/`.

### Wersja release + stały link do pobrania

Workflow `.github/workflows/release.yml` buduje **podpisany** APK (`assembleRelease`)
i publikuje go w **GitHub Releases** pod stałym tagiem `latest`. Uruchom go ręcznie
(**Actions → Release APK → Run workflow**) lub wypchnij tag `v*`. Stały link:

```
https://github.com/Talent620/Jarvis/releases/download/latest/jarvis.apk
```

> 🔐 **Podpisywanie:** w repo dołączony jest osobisty klucz `android/keystore/jarvis.jks`
> (hasło w `android/app/build.gradle`). To wygodne do prywatnego udostępniania, ale
> **nie jest to klucz produkcyjny** — kto ma keystore, może podpisać aktualizację tej
> aplikacji. Do publikacji w Google Play wygeneruj własny, tajny keystore i trzymaj go
> w sekretach (nie w repo).

## Wersja na komputer (Windows .exe)

Aplikacja działa też jako **przenośny program na Windows** (Electron) — jeden plik
`JARVIS.exe`, bez instalacji. CI `.github/workflows/windows.yml` buduje go i publikuje
w Releases pod stałym linkiem:

```
https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe
```

Klucze API są wstrzykiwane przy buildzie z **Secrets repo** (te same `JARVIS_*_KEY`
co APK), więc `.exe` ma je „od razu". Bez ustawionych Secrets — wpisujesz klucz w ⚙.

Lokalnie (na dowolnym OS z Node):

```bash
npm install
npm run desktop:build   # → release-desktop/JARVIS.exe (na Windows)
```

Wersja desktopowa jest pełna: czat, projekty/dokumenty, research z cytatami, rozmowa na
żywo (Gemini), TTS, smart home, sync. Naprawiono CORS w Electronie, więc **wszyscy
dostawcy AI działają** (Gemini, Claude, Groq, OpenRouter, NVIDIA, GitHub). Dochodzą:
menu, zapamiętywanie rozmiaru okna, pojedyncza instancja, linki w przeglądarce.

> Uwaga: `.exe` jest niepodpisany — Windows SmartScreen może ostrzec („Więcej informacji →
> Uruchom mimo to"). Dyktowanie głosem (STT) bywa niedostępne w Electronie; tekst, TTS
> i rozmowa na żywo (Gemini) działają.

## Wersja na Apple (iOS)

Projekt zawiera natywny projekt iOS (`ios/`, Capacitor) z ustawionymi opisami
uprawnień (mikrofon, mowa, aparat, zdjęcia, kontakty, kalendarz).

**Wymagania (narzucone przez Apple):** zbudowanie i zainstalowanie aplikacji iOS
wymaga **komputera Mac z Xcode**. Instalacja na realnym iPhonie wymaga **podpisu**
certyfikatem z **konta Apple Developer** (darmowe konto = instalacja tylko na
własnym urządzeniu, ważna 7 dni; konto płatne 99 USD/rok = pełna dystrybucja /
TestFlight). Nie da się tego obejść z poziomu Windowsa/Androida ani darmowego CI.

**Budowa na Macu:**

```bash
npm install
npm run build
npx cap sync ios
npx cap open ios   # otwiera Xcode
```

W Xcode: wybierz swój zespół (Signing & Capabilities → Team), podłącz iPhone’a
i kliknij ▶ (Run), albo Product → Archive → Distribute (TestFlight/Ad Hoc).

> CI `.github/workflows/ios.yml` buduje wersję pod symulator (bez podpisu) na
> macOS — to tylko weryfikacja, że projekt się kompiluje; nie tworzy pliku do
> instalacji na telefonie (to wymaga Twojego certyfikatu Apple).

## Struktura

```
src/
  lib/
    brain.ts         orkiestrator: system prompt + wybór dostawcy/modelu
    providers/       adaptery AI (anthropic, openai-compat, gemini) + rejestr modeli
    tools.ts         definicje i wykonawcy narzędzi agentowych
    deviceControl.ts otwieranie aplikacji / dzwonienie / nawigacja / smart home
    voice.ts         STT (słowo-klucz) + TTS (głos JARVIS / ElevenLabs)
    store.ts         trwały magazyn danych i ustawień (localStorage)
  components/        UI w stylu HUD (orb, rozmowa, panele, ustawienia)
  App.tsx            spięcie całości
android/             natywny projekt Android (Capacitor)
proxy/               opcjonalny backend-proxy (Cloudflare Worker) — CORS + ukrycie kluczy
.github/workflows/   CI budujące APK
```

## Smart home (Home Assistant)

W ⚙ Ustawieniach podaj adres instancji Home Assistant i długoterminowy token.
Następnie mów/pisz naturalnie, np. „Jarvis, zgaś światło w salonie" — JARVIS
wywoła encję (`light.salon`, `switch.czajnik`, `climate.sypialnia`…). Jeśli HA
blokuje CORS, użyj `proxy/` (trasa `/passthrough`).

## AI Sales OS (osobne, zintegrowane narzędzie)

W katalogu [`sales-os/`](sales-os/) leży **kompletna, osobna aplikacja** do pozyskiwania
klientów (Next.js 14 + Postgres + Prisma): przechwytywanie leadów, scoring, lejek CRM,
generowanie wiadomości przez AI i Copilot. Korzystasz z niej **w przeglądarce** — JARVIS
jej nie wchłania, tylko ma do niej **wgląd** i synchronizuje leady. Dwa osobne narzędzia,
jeden token.

**Uruchomienie jednym poleceniem** (z katalogu JARVIS-a):

```bash
npm run salesos        # baza (Docker) → zależności → schemat → dane demo → serwer
```

Aplikacja wstaje na **http://localhost:3000** (login demo: `owner@northstar.studio` / `demo1234`).
Warstwa AI działa od ręki, bez kluczy (wbudowany silnik „mock").

**Połączenie z JARVIS-em** (⚙ → Integracje → *AI Sales OS*):

1. W Sales OS skopiuj token z **⚙ → Pozyskiwanie → Inbound** (`X-Ingest-Token`).
2. W JARVIS-ie wklej adres (`http://localhost:3000`) i ten token.
3. **🚀 Otwórz Sales OS** — jeden klik otwiera aplikację; **⬇ Synchronizuj leady** —
   pobiera leady i metryki (read-only) do Pulpitu Sprzedaży (dedup po nazwie firmy);
   **🔌 Test połączenia** — sprawdza token i pokazuje skrót pipeline’u; **📤 Wyślij leady
   do Sales OS** — odsyła firmy znalezione w JARVIS-ie (OSM) do CRM-u. Te same przyciski
   są w Pulpicie Sprzedaży, gdy adres jest ustawiony.

**Auto-synchronizacja.** W ⚙ → Integracje ustawisz odświeżanie co 15 min / 30 min / godzinę
/ 4 h — JARVIS sam dociąga nowe leady w tle i melduje, ile pobrał. Statusy mapują się 1:1
z lejkiem Sales OS (New/Contacted/Qualified → nowy/kontakt, Proposal/Negotiation → oferta,
Won/Lost → klient/odrzucony; rozumie też polskie nazwy etapów). Po synchronizacji Pulpit
pokazuje skrót metryk (leady, otwarte/klienci/odrzuceni, wartość wygranych).

**Maile pisane i wysyłane w CRM-ie.** JARVIS może zlecić Sales OS-owi napisanie (AI) i
**automatyczną wysyłkę** pierwszego kontaktu do leada — treść, scoring, kolejka akceptacji
i dostawca poczty (Resend/Mailgun) żyją w Sales OS, a JARVIS tylko wyzwala akcję tokenem
(`POST /api/public/outreach`). „Napisz i wyślij mail do <firma> przez Sales OS” utworzy
leada (jeśli trzeba), wygeneruje wiadomość i ją wyśle; „auto-wyślij zaległe maile” opróżni
kolejkę szkiców do dziennego limitu firmy. Bez klucza poczty Sales OS robi „symulowaną”
wysyłkę (pełny ślad w osi czasu) — ustaw `RESEND_API_KEY`, by wysyłać naprawdę.

**Dwukierunkowy status.** Zmiana statusu leada z CRM-u (Teczka Klienta lub komenda
„oznacz <firma> jako klienta”) wraca do lejka Sales OS — etap i wynik aktualizują się po
obu stronach (`POST /api/public/lead-status`, ślad `STAGE_CHANGE` w osi czasu).

**Sterowanie głosem/czatem.** Asystent ma siedem narzędzi i sam je odpala w kontekście:
`salesos_open` („otwórz Sales OS”), `salesos_sync` („zsynchronizuj leady z CRM-u”),
`salesos_stats` („ile mam leadów w Sales OS / jak idzie pipeline”), `salesos_push`
(„wyślij te firmy do Sales OS”), `salesos_email` („napisz i wyślij mail do <firma>”),
`salesos_flush_emails` („roześlij przygotowane wiadomości”) oraz `salesos_set_status`
(„oznacz <firma> jako klienta / przesuń na ofertę”).

Pod spodem JARVIS odpytuje dodany endpoint `GET /api/public/sync` (read-only) i wysyła
firmy przez `POST /api/public/leads` — oba autoryzowane tym samym tokenem. Sales OS
pozostaje źródłem prawdy (scoring, lejek, dedup); JARVIS odzwierciedla jego dane i może
go zasilać znalezionymi leadami.

## BFF — klucze poza aplikacją (zalecane)

JARVIS **nie wpieka kluczy do bundla**. Wbudowane (darmowe) modele działają przez **BFF**
(Cloudflare Worker w `proxy/`), który dokleja klucze po stronie serwera. Wdrożenie:

```bash
cd proxy
cp .dev.vars.example .dev.vars            # uzupełnij WŁASNYMI kluczami (lokalny dev)
wrangler login
wrangler kv namespace create JARVIS_KV    # wklej zwrócone id do wrangler.toml
# ustaw sekrety produkcyjne (po jednym):
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENROUTER_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put GEMINI_API_KEY
# …pozostałe wg .dev.vars.example (TAVILY_API_KEY, NVIDIA_API_KEY, MISTRAL_API_KEY, CEREBRAS_API_KEY, GITHUB_MODELS_TOKEN)
wrangler deploy                            # → https://jarvis-bff.<konto>.workers.dev
```

Następnie **zbuduj aplikację z adresem BFF**, by cały ruch AI szedł przez niego automatycznie:

```bash
VITE_BFF_URL="https://jarvis-bff.<konto>.workers.dev" npm run build
```

Hardening (opcjonalny, sekrety workera): **`APP_TOKEN`** — gdy ustawisz, klient musi słać
`x-app-token`; zbuduj wtedy aplikację z `VITE_APP_TOKEN="…"` (ta sama wartość). Dodatkowo
`ALLOWED_ORIGINS` (CSV) i `RATE_LIMIT_PER_MIN`. Bez tych zmiennych zachowanie jak dotąd.

**Tryb „własny klucz" (BYOK):** bez BFF użytkownik może wpisać własny klucz w ⚙ → AI —
trzymany lokalnie (opcjonalnie za blokadą PIN). Pełne szczegóły: `proxy/README.md`.

## Premium głos „jak z filmu"

Dokładny głos JARVIS-a z filmów jest objęty prawami autorskimi i nie jest dołączony.
Aby uzyskać najbliższe brzmienie, w Ustawieniach podaj **klucz ElevenLabs** oraz
**ID głosu** (np. własny sklonowany głos). Bez tego JARVIS użyje najbardziej
„brytyjsko-męskiego" głosu dostępnego w systemie.

## Status funkcji

| Obszar | Status |
|---|---|
| Asystent AI (multi-dostawca, tool-use, pamięć, głos, wizja) | ✅ gotowe |
| Produktywność (zadania/notatki/kalendarz/przypomnienia/zakupy) | ✅ gotowe |
| Pulpit Sprzedaży / CRM, leady, oferty, follow-upy | ✅ gotowe |
| Wysyłka e-maili z aplikacji (SMTP / przekaźnik / Gmail) + Skrzynka wysłanych | ✅ gotowe |
| Gmail: czytanie + odpowiedź w wątku · Kalendarz Google: odczyt/zapis | ✅ gotowe *(wymaga podłączenia konta Google w backendzie)* |
| Maszynka do kontentu · Generator reklam (bez API) | ✅ gotowe |
| Automatyzacja reklam przez API (Google Ads / Meta) — wyniki i zarządzanie | 🔜 planowane (Fazy 1–2) |
| iOS — instalowalny build (TestFlight) | 🔜 wymaga konta Apple Developer |

## Changelog (ostatnia sesja dopracowania)

- **Sprzedaż:** wyszukiwarka leadów, znacznik „✉ wysłano", dedup przy ręcznym dodawaniu,
  licznik „wysłane dziś" w statystykach.
- **Poczta:** „Napisz i wyślij" jednym kliknięciem, przekaźnik SMTP w backendzie (telefon,
  bez Google OAuth), Skrzynka wysłanych (licznik „dziś", eksport CSV, czyszczenie),
  automatyczny podpis, test poczty i sprawdzenie połączenia, czytelne nazwy przycisków.
- **Gmail/Kalendarz:** czytanie pełnej treści maila i odpowiedź w wątku; odczyt kalendarza
  na konkretny dzień; poranny briefing czyta kalendarz Google i nieprzeczytane maile.
- **Treści/Reklamy:** Maszynka do kontentu (+historia postów) i Generator reklam (Google/Meta).
- **Odporność (edge case'y):** kopiowanie z fallbackiem (starszy WebView), poprawne
  anulowanie udostępniania, timeouty wywołań backendu (brak sieci nie zawiesza),
  przycinanie zbyt długiego wejścia, kopia zapasowa obejmuje skrzynkę wysłanych
  i historię postów (nie giną przy przenosinach na inny komputer).
- **Licencja:** rotacja pary kluczy ECDSA (klucz prywatny poza repo).
