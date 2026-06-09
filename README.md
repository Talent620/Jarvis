# JARVIS · AI Assistant 2.0

Agentowy asystent głosowy i tekstowy w stylu HUD, napędzany **Claude Opus 4.8**.
Aplikacja webowa (React + Vite) opakowana w Androida przez **Capacitor** — następca
oryginalnego `JARVIS.apk`, tym razem z pełnym kodem źródłowym, który możesz dowolnie
modyfikować i z którego zbudujesz nowy APK.

## Co potrafi

- **Agentowy mózg (Claude Opus 4.8)** — myślenie adaptacyjne + tool-use: realnie
  wykonuje zadania, nie tylko odpowiada.
- **Pamięć** — zapamiętuje trwałe fakty i preferencje o użytkowniku (`remember_fact`).
- **Wiedza w czasie rzeczywistym** — wyszukiwanie w sieci (serwerowe narzędzie Claude):
  pogoda, wiadomości, kursy, fakty po dacie treningu.
- **Głos** — ciągłe nasłuchiwanie słowa-klucza „Jarvis", rozpoznawanie mowy (STT)
  i synteza mowy (TTS) z głosem dobranym pod styl JARVIS-a; opcjonalnie premium
  głos przez ElevenLabs.
- **Sterowanie urządzeniem i usługami** — otwieranie aplikacji (Spotify, YouTube,
  Mapy, Gmail, WhatsApp, Allegro/OLX…), dzwonienie, SMS, nawigacja.
- **Produktywność** — zadania, notatki, przypomnienia, kalendarz, lista zakupów.

## Konfiguracja

Po pierwszym uruchomieniu wejdź w **⚙ Ustawienia** i wprowadź **klucz API Anthropic**
(`sk-ant-...`). Klucz jest przechowywany **lokalnie na urządzeniu** (localStorage),
nie jest nigdzie wysyłany poza oficjalne API Anthropic.

> ⚠️ Uwaga bezpieczeństwa: w wersji bez własnego backendu klucz API żyje w aplikacji
> klienckiej. To wygodne do użytku osobistego, ale jeśli planujesz dystrybucję,
> rozważ dodanie własnego serwera-proxy, który trzyma klucz po stronie serwera.

## Uruchomienie lokalne (web)

```bash
npm install
npm run dev
```

Otwórz adres podany przez Vite (domyślnie http://localhost:5173).

> Rozpoznawanie mowy działa w przeglądarkach opartych na Chromium oraz w WebView
> Androida. TTS działa wszędzie tam, gdzie dostępne jest Web Speech API.

## Budowa APK (Android)

```bash
# 1. Zbuduj front
npm run build

# 2. Dodaj platformę Android (jednorazowo)
npx cap add android

# 3. Zsynchronizuj i otwórz w Android Studio
npx cap sync android
npx cap open android
```

W Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
Gotowy plik znajdziesz w `android/app/build/outputs/apk/`.

Wymagane uprawnienia w `AndroidManifest.xml` (Android Studio doda część automatycznie;
dla mikrofonu i internetu upewnij się, że są):

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

## Struktura

```
src/
  lib/
    claude.ts        agentowa pętla Claude Opus 4.8 (tool-use + web search)
    tools.ts         definicje i wykonawcy narzędzi
    deviceControl.ts otwieranie aplikacji / dzwonienie / nawigacja
    voice.ts         STT (słowo-klucz) + TTS (głos JARVIS / ElevenLabs)
    store.ts         trwały magazyn danych i ustawień (localStorage)
  components/        UI w stylu HUD (orb, rozmowa, panele, ustawienia)
  App.tsx            spięcie całości
```

## Premium głos „jak z filmu"

Dokładny głos JARVIS-a z filmów jest objęty prawami autorskimi i nie jest dołączony.
Aby uzyskać najbliższe brzmienie, w Ustawieniach podaj **klucz ElevenLabs** oraz
**ID głosu** (np. własny sklonowany głos). Bez tego JARVIS użyje najbardziej
„brytyjsko-męskiego" głosu dostępnego w systemie.
