# JARVIS · AI Assistant 2.0

Agentowy asystent głosowy i tekstowy w stylu HUD, napędzany **Claude Opus 4.8**.
Aplikacja webowa (React + Vite) opakowana w Androida przez **Capacitor** — następca
oryginalnego `JARVIS.apk`, tym razem z pełnym kodem źródłowym, który możesz dowolnie
modyfikować i z którego zbudujesz nowy APK.

## Co potrafi

- **Wybór modelu z wielu dostawców** — Claude (Opus 4.8), Google Gemini, Groq,
  OpenRouter (35+ modeli), NVIDIA NIM, GitHub Models. Tryb **auto** sam dobiera
  najlepszy dostępny model na podstawie wpisanych kluczy.
- **Agentowy mózg** — tool-use w każdym dostawcy (function calling): realnie
  wykonuje zadania, nie tylko odpowiada. Claude dodatkowo z myśleniem adaptacyjnym
  i serwerowym wyszukiwaniem w sieci.
- **Pamięć** — zapamiętuje trwałe fakty i preferencje o użytkowniku (`remember_fact`).
- **Wiedza w czasie rzeczywistym** — wyszukiwanie w sieci (serwerowe narzędzie Claude):
  pogoda, wiadomości, kursy, fakty po dacie treningu.
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
- **Płynne odpowiedzi** — efekt „pisania na żywo" + trwała historia rozmowy i „nowa rozmowa".
- **Szybkie akcje** — podpowiadane komendy na start.
- **Przejrzysty UI mobilny** — panele jako bottom-sheet z przewijaną treścią i stałą
  stopką (nic się nie ucina, bezpieczne marginesy pod notch/gesty).
- **Produktywność** — zadania, notatki, przypomnienia, kalendarz, lista zakupów.

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

## Backend-proxy (opcjonalnie)

Dla dostawców blokujących przeglądarkę (NVIDIA NIM, GitHub Models) oraz aby ukryć
klucze po stronie serwera — wdróż proxy z katalogu `proxy/` i wpisz jego adres
w ustawieniach. Szczegóły: `proxy/README.md`.

## Premium głos „jak z filmu"

Dokładny głos JARVIS-a z filmów jest objęty prawami autorskimi i nie jest dołączony.
Aby uzyskać najbliższe brzmienie, w Ustawieniach podaj **klucz ElevenLabs** oraz
**ID głosu** (np. własny sklonowany głos). Bez tego JARVIS użyje najbardziej
„brytyjsko-męskiego" głosu dostępnego w systemie.
