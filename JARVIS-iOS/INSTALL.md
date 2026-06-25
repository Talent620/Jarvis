# JARVIS iOS — instalacja z jednego pliku (`.ipa`)

Praktyczny przewodnik (stan: czerwiec 2026), jak zrobić **jeden plik instalacyjny**
JARVIS-a na iPhone'a i jak go faktycznie zainstalować. Dół dokumentu = źródła.

---

## TL;DR — co wybrać

| Metoda | Koszt | Ważność builda | Wygoda dla odbiorcy | „Jeden plik"? |
|---|---|---|---|---|
| **TestFlight** | 99 $/rok | 90 dni | ⭐ najłatwiej — klik w link | nie (to link, nie plik) |
| **Ad‑hoc + Diawi/InstallOnAir** | 99 $/rok | ~1 rok | klik w link, ale najpierw wyślą Ci UDID | **tak** (.ipa za linkiem) |
| **Darmowe Apple ID + AltStore/SideStore** | 0 zł | 7 dni (auto‑odnawiane) | jednorazowa konfiguracja | nie (instalacja przez apkę‑sklep) |
| **Darmowe Apple ID + Sideloadly** | 0 zł | 7 dni, max 3 apki | wymaga Maca/PC i powtarzania co tydzień | **tak** (.ipa, wygasa co 7 dni) |
| **TrollStore** | 0 zł | na stałe | tylko **iOS ≤ 17.0** | tak, ale ograniczone wersją iOS |

**Rekomendacja dla appki dla siebie / kilku osób:**
- Chcesz świętego spokoju i masz 99 $/rok → **TestFlight**.
- Chcesz dosłownie *jeden plik do kliknięcia* i masz 99 $/rok → **ad‑hoc + InstallOnAir/Diawi**.
- Nie chcesz płacić → **AltStore / SideStore** (akceptując odświeżanie co 7 dni).

> ⚠️ **Ważna prawda o podpisywaniu:** iOS **nie uruchomi** aplikacji bez ważnego
> podpisu i profilu provisioning. *Niepodpisany* `.ipa` (taki, jaki tworzy nasze CI)
> **nie zainstaluje się** na zwykłym iPhonie — narzędzia typu Sideloadly/AltStore
> **podpisują go ponownie** Twoim Apple ID przy instalacji. Niepodpisany plik wprost
> instaluje tylko TrollStore/jailbreak (i tylko na iOS ≤ 17.0).

---

## Skąd wziąć plik `.ipa`

### A) Z naszego CI (niepodpisany — do re‑podpisania)
Po każdym pushu workflow [`.github/workflows/ios.yml`](../.github/workflows/ios.yml) buduje
appkę na macOS i wrzuca artefakt **`JARVIS-unsigned-ipa`** (plik `JARVIS-unsigned.ipa`).
Pobierz go z karty **Actions → iOS build → Artifacts**. To gotowy plik do podania
Sideloadly/AltStore (które go podpiszą) albo do TrollStore.

### B) Lokalnie z Xcode (podpisany — gotowy do ad‑hoc/TestFlight)
Potrzebny Mac + Xcode 16+. Najprościej z GUI: **Product → Archive → Distribute App**.
Z terminala (archiwum → eksport):

```bash
cd JARVIS-iOS

# 1) archiwum
xcodebuild archive \
  -project JARVIS.xcodeproj \
  -scheme JARVIS \
  -configuration Release \
  -archivePath build/JARVIS.xcarchive \
  -allowProvisioningUpdates

# 2) eksport do .ipa wg ExportOptions.plist (patrz niżej)
xcodebuild -exportArchive \
  -archivePath build/JARVIS.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export
# → build/export/JARVIS.ipa
```

`ExportOptions.plist` (ad‑hoc, automatyczne podpisywanie — podmień `TEAMID`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>        <string>ad-hoc</string>
    <key>teamID</key>        <string>TEAMID</string>
    <key>signingStyle</key>  <string>automatic</string>
</dict>
</plist>
```

> Uwaga: w `ExportOptions.plist` używaj **starych** nazw metod (`ad-hoc`, `app-store`,
> `development`, `enterprise`) — działają wszędzie. Xcode 15.3+ pokazuje w GUI nowe
> nazwy (`release-testing`, `app-store-connect`, `debugging`), ale plist potrafi je
> odrzucać.

---

## Ścieżki instalacji — krok po kroku

### 1) Darmowo: AltStore / SideStore (zalecane bez płacenia)
- **AltStore Classic** (cały świat): zainstaluj **AltServer** na Mac/PC, podłącz iPhone,
  zaloguj darmowym Apple ID → AltStore odświeża podpis automatycznie co ~7 dni, gdy
  telefon i komputer są w tej samej sieci. Wgraj `JARVIS-unsigned.ipa` przez „+".
- **SideStore**: wariant odświeżający podpis **na samym telefonie** (lokalny VPN/WireGuard)
  — po konfiguracji nie potrzebujesz komputera.
- Limit darmowego konta: **3 aplikacje** naraz, podpis ważny **7 dni** (narzędzia same go odnawiają).
- W EU: **AltStore PAL** (iOS 17.4+, konto EU, bez komputera, darmowy od 2024).

### 2) Darmowo, „jeden plik": Sideloadly
1. Zainstaluj Sideloadly (Mac/Windows), podłącz iPhone.
2. Przeciągnij `JARVIS-unsigned.ipa`, podaj **darmowe Apple ID** → Start (Sideloadly podpisze plik).
3. Na iPhonie: **Ustawienia → Ogólne → VPN i zarządzanie urządzeniem** → zaufaj certyfikatowi,
   oraz **Prywatność i ochrona → Tryb programisty** → włącz.
4. Podpis wygasa po 7 dniach — powtórz instalację.

### 3) Płatnie, najwygodniej: TestFlight
1. Konto **Apple Developer Program** (99 $/rok), bundle id `net.serwer256.jarvis` w App Store Connect.
2. `Product → Archive → Distribute App → TestFlight` (lub `xcodebuild` z `method = app-store` +
   `xcrun altool`/`notarytool`).
3. Zaproś testerów linkiem; oni instalują przez apkę **TestFlight**. Build żyje 90 dni.

### 4) Płatnie, dosłownie „jeden plik": ad‑hoc + InstallOnAir/Diawi
1. Zbierz **UDID** urządzeń odbiorców i zarejestruj je (do 100/rok) w portalu deweloperskim.
2. Zbuduj `.ipa` z `method = ad-hoc` (patrz wyżej).
3. Wrzuć plik na **InstallOnAir** lub **Diawi** → dostajesz link/QR „dotknij, by zainstalować".
   Profil ad‑hoc jest ważny ~1 rok. Instalacja tylko na zarejestrowanych UDID.

### 5) Darmowo, na stałe: TrollStore (tylko iOS ≤ 17.0)
Jeśli telefon odbiorcy ma **iOS 14.0 beta 2 – 16.6.1, 16.7 RC lub 17.0** — TrollStore instaluje
*niepodpisany* `JARVIS-unsigned.ipa` **na stałe**, bez komputera i bez odnawiania.
Dla iOS 17.0.1+ / 18 / 19 / 26 **nie istnieje** metoda TrollStore — to ślepa uliczka dla
większości użytkowników w 2026.

---

## Podpisany build w CI (opcjonalnie, dla TestFlight/ad‑hoc)

Nasze CI robi build *niepodpisany*. Żeby CI produkowało **podpisany** `.ipa`, trzeba dodać
sekrety (certyfikat `.p12` + profil `.mobileprovision` w base64, hasło) i zaimportować je do
tymczasowego keychaina przed `exportArchive` — patrz oficjalny poradnik GitHuba lub akcja
`apple-actions/import-codesign-certs`. Wygodniej zarządzać tym przez **fastlane match** +
**App Store Connect API key** (`.p8` + Key ID + Issuer ID) do logowania bez hasła/2FA.

```ruby
# Fastfile (skrót)
lane :beta do
  app_store_connect_api_key(key_id: ENV["ASC_KEY_ID"], issuer_id: ENV["ASC_ISSUER_ID"],
                            key_content: ENV["ASC_KEY_CONTENT"], is_key_content_base64: true)
  setup_ci
  match(type: "appstore", readonly: true)
  build_app(scheme: "JARVIS")
  upload_to_testflight
end
```

---

## Źródła

- Struktura .ipa — https://en.wikipedia.org/wiki/.ipa
- Zmiana nazw metod eksportu (Xcode 15.3) — https://github.com/bitrise-steplib/steps-xcode-archive
- plist nadal oczekuje starych nazw — https://github.com/tauri-apps/tauri/issues/13818
- exportArchive — https://developer.apple.com/forums/thread/89290
- TrollStore (wspierane wersje iOS) — https://github.com/opa334/TrollStore
- Porównanie członkostw / limity — https://developer.apple.com/support/compare-memberships/
- TestFlight — https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- AltStore PAL / darmowy — https://9to5mac.com/2024/08/15/altstore-pal-free/ , https://www.macrumors.com/2024/04/17/altstore-eu-alternative-app-marketplace/
- SideStore — https://sidestore.io/ , https://docs.sidestore.io/docs/faq
- Sideloadly — https://sideloadly.io/faq.html
- DMA / EU / CTF→CTC — https://developer.apple.com/support/dma-and-apps-in-the-eu/ , https://developer.apple.com/support/core-technology-fee/
- InstallOnAir — https://installonair.com/features
- GitHub Actions: certyfikat na runnerze — https://docs.github.com/actions/use-cases-and-examples/deploying/installing-an-apple-certificate-on-macos-runners-for-xcode-development
- fastlane match / ASC API — https://docs.fastlane.tools/actions/match/ , https://docs.fastlane.tools/app-store-connect-api/
- Niepodpisany .ipa — https://github.com/MrKai77/Export-unsigned-ipa-files
