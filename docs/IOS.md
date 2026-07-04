# 🍏 JARVIS na iPhone (iOS) — jak zbudować i zainstalować

## Najpierw szczera prawda (ważne)
- **iOS nie zbudujesz z Windowsa jednym `.exe` jak APK.** Apple wymaga **macOS + Xcode** (albo macOS w chmurze — robi to za Ciebie nasze CI).
- **Instalacja na iPhone wymaga podpisu Apple.** Są 3 drogi (od najtańszej):
  1. **Sideload Twoim Apple ID** (za darmo) — plik `.ipa` podpisuje się na Twoim koncie. Limit: aplikacja działa **7 dni**, potem odśwież (AltStore robi to sam, gdy telefon jest w domowej sieci).
  2. **TestFlight** — wygodne dla wielu osób, ale wymaga **Apple Developer (99 USD/rok)**.
  3. **App Store** — publiczna dystrybucja, też konto Developer + recenzja Apple.

Większość ludzi chce drogi **#1 (za darmo)** — i pod nią jest poniższy „jeden klik”.

---

## ✅ Ścieżka „jeden klik” (z Windowsa, bez Maca) — zalecana
Nasze CI buduje gotowy **niepodpisany `JARVIS.ipa`** na macOS-runnerze i wrzuca go do wydania.

1. **Zbuduj** (jeden klik): w repo → zakładka **Actions** → workflow **„Build iOS (.ipa)”** → **Run workflow**.
   (Albo: i tak odpala się sam przy każdej zmianie w `ios/**` lub `src/**`.)
2. **Pobierz** gotowy plik (po ~5–10 min):
   ```
   https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.ipa
   ```
3. **Zainstaluj na iPhone** jedną z dwóch darmowych metod:

   **A) Sideloadly (najprościej, z PC/Mac):**
   - Pobierz Sideloadly: https://sideloadly.io (Windows/Mac)
   - Podłącz iPhone kablem, przeciągnij `JARVIS.ipa`, zaloguj **swoim Apple ID** → **Start**.
   - Na iPhone: **Ustawienia → Ogólne → VPN i zarządzanie urządzeniem → zaufaj** swojemu profilowi.

   **B) AltStore (auto-odświeżanie co 7 dni):**
   - Zainstaluj AltServer na PC/Mac: https://altstore.io, a AltStore na iPhone.
   - W AltStore: **My Apps → + → wskaż `JARVIS.ipa`**, zaloguj Apple ID.
   - Zaleta: gdy telefon jest w tej samej sieci Wi-Fi co PC z AltServer, **sam odnawia** podpis (nie wygasa).

> Po instalacji „zaufaj” profilowi: **Ustawienia → Ogólne → VPN i zarządzanie urządzeniem**.

---

## 🖥 Masz Maca? Jeszcze prościej
Na komputerze Mac, w katalogu projektu:

- **Najszybciej — wgraj prosto na iPhone przez Xcode (darmowy Apple ID):**
  ```bash
  npm run ios:open        # zbuduje web + sync + otworzy projekt w Xcode
  ```
  W Xcode: zaznacz target **App → Signing & Capabilities → Team:** wybierz swój (darmowy) Apple ID →
  podłącz iPhone, wybierz go u góry → **▶ Run**. Aplikacja wgra się na telefon (działa 7 dni, potem znów ▶).

- **Albo zbuduj plik `.ipa` jedną komendą** (do Sideloadly/AltStore):
  ```bash
  npm run ios:build       # → ./JARVIS.ipa (niepodpisany)
  ```
  Wymaga: Xcode (App Store) + CocoaPods (`brew install cocoapods`).

---

## 💳 Droga „pro” (TestFlight, wiele osób) — opcjonalnie
Wymaga **Apple Developer (99 USD/rok)**. W skrócie:
1. Zarejestruj się: https://developer.apple.com/programs/
2. W App Store Connect utwórz aplikację (bundle id: `net.serwer256.jarvis`).
3. W Xcode ustaw **Team** + automatyczny podpis, **Product → Archive → Distribute → App Store Connect**.
4. Wgraj do **TestFlight**, dodaj testerów mailem — instalują przez apkę TestFlight (bez kabla, bez limitów 7 dni).
*(Jeśli chcesz, dorobimy workflow CI z podpisem z sekretów — wtedy `.ipa` z TestFlightu też leci „jednym kliknięciem”.)*

---

## Co już jest przygotowane w projekcie
- `ios/` — gotowy projekt Capacitor (bundle id `net.serwer256.jarvis`, nazwa „JARVIS”).
- `Info.plist` — komplet zgód po polsku: **mikrofon, rozpoznawanie mowy, aparat, zdjęcia, kontakty, kalendarz**.
- `CapacitorHttp` włączony — natywne żądania omijają CORS (np. dla lokalnej Ollamy z telefonu).
- Workflow **„Build iOS (.ipa)”** — buduje i publikuje niepodpisany `.ipa`.
- `npm run ios:open` / `npm run ios:build` — wygodne komendy na Macu.

## Coś nie działa?
- **„Untrusted Developer” po instalacji** → Ustawienia → Ogólne → VPN i zarządzanie urządzeniem → zaufaj profilowi.
- **Aplikacja przestała się otwierać po ~tygodniu** → to limit darmowego Apple ID (7 dni). Odśwież w AltStore albo wgraj ponownie (Sideloadly / Xcode ▶).
- **CI build się wywala na `pod install`** → zwykle przejściowy problem CocoaPods; uruchom workflow ponownie.
- **Mikrofon/aparat nie pyta o zgodę** → upewnij się, że to wersja z tego repo (zgody są w `Info.plist`).
</content>
