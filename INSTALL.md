# JARVIS na iPhone — instalacja pliku `.ipa` BEZ Maca (2026)

Ten dokument tłumaczy, jak wziąć gotowy plik **`JARVIS-unsigned.ipa`** (budowany
automatycznie przez GitHub Actions) i wgrać go na iPhone'a, **nie mając komputera Mac**.

---

## Skąd wziąć plik `.ipa`

1. Wejdź na GitHub → zakładka **Actions** → workflow **„iOS (Capacitor) — build .ipa”**.
2. Otwórz ostatni zielony przebieg → sekcja **Artifacts** → pobierz **`JARVIS-unsigned-ipa`**.
3. Rozpakuj ZIP — w środku jest `JARVIS-unsigned.ipa`. To Twoja „igła”.

> ⚠️ Plik jest **niesygnowany**. iOS nie uruchomi aplikacji bez podpisu, dlatego
> narzędzia poniżej **podpisują go w locie Twoim własnym Apple ID** podczas instalacji.
> Niczego nie musisz robić ręcznie z podpisem — robi to za Ciebie sideloader.

---

## Najprościej bez Maca — 3 ścieżki

### 1) AltStore PAL (tylko UE) — bez komputera, „własny App Store”
Po wejściu w życie unijnego **DMA** (marzec 2024) Apple musi dopuszczać alternatywne
sklepy z aplikacjami na iPhone'a. **AltStore PAL** to taki autoryzowany sklep:
- wymaga **iOS 17.4+** i konta Apple z regionem **UE**,
- instaluje się **bez komputera**, od sierpnia 2024 jest **darmowy**,
- w sklepie wskazujesz źródło/plik `.ipa`, a on sam zarządza podpisem i odświeżaniem.

To najwygodniejsza opcja „bez Maca”, jeśli jesteś w UE.

### 2) SideStore — odświeża podpis na samym telefonie
Fork AltStore, który po jednorazowej konfiguracji **odświeża aplikację bezpośrednio na
iPhonie** (lokalny VPN/WireGuard), więc na co dzień **nie potrzebujesz komputera**.
Wgrywasz `JARVIS-unsigned.ipa`, logujesz darmowym Apple ID. Limit darmowego konta:
**3 aplikacje** i podpis ważny **7 dni** (SideStore odnawia go sam).

### 3) Sideloadly / AltStore Classic — działają wszędzie (potrzebny raz komputer)
Jeśli nie jesteś w UE, najpewniejsze są klasyczne narzędzia. Wymagają **jednorazowo**
komputera z Windows/Mac do pierwszej instalacji:
- **Sideloadly** (Windows/Mac): przeciągasz `.ipa`, podajesz darmowe Apple ID → instaluje.
- **AltStore Classic**: serwer **AltServer** na PC odświeża podpis automatycznie co ~7 dni,
  gdy telefon i komputer są w tej samej sieci Wi-Fi.

Po instalacji wejdź na iPhonie w **Ustawienia → Ogólne → VPN i zarządzanie urządzeniem**
i **zaufaj** certyfikatowi, a w **Prywatność i ochrona → Tryb programisty** włącz tryb
programisty (iOS 16+).

> Darmowe Apple ID: podpis wygasa po **7 dniach** i możesz mieć max **3** takie aplikacje.
> AltStore/SideStore ukrywają tę uciążliwość, odnawiając podpis automatycznie.

---

## TrollStore — instalacja na stałe (ale tylko stare iOS)
**TrollStore** instaluje *niesygnowane* `.ipa` **na zawsze**, bez komputera i bez odnawiania
co 7 dni. Haczyk: działa wyłącznie na **iOS 14.0 beta 2 – 16.6.1, 16.7 RC oraz 17.0**.
Dla **iOS 17.0.1+ / 18 / 19 / 26 nie istnieje** metoda TrollStore — to ślepa uliczka dla
większości telefonów w 2026. Jeśli masz starszego iPhone'a w tym zakresie — to najlepsza,
darmowa i trwała opcja: zainstaluj TrollStore, a potem otwórz nim `JARVIS-unsigned.ipa`.

---

## Wpływ regulacji UE (DMA) — dlaczego w Europie jest łatwiej
- **DMA** obowiązuje od marca 2024 i zmusił Apple do otwarcia iOS w UE na **alternatywne
  sklepy** (jak AltStore PAL) oraz **dystrybucję z własnej strony WWW** (tzw. *Web
  Distribution* — pobranie `.ipa` z linku), dla kont z regionem UE i iOS 17.4+/17.5+.
- Aplikacje spoza App Store w UE i tak przechodzą **notaryzację** Apple (automatyczne +
  ludzkie sprawdzenie bezpieczeństwa), ale **nie** muszą trafiać do App Store.
- **Opłaty** (Core Technology Fee / nowsza Core Technology Commission) dotyczą dopiero
  aplikacji z **ponad 1 mln** instalacji rocznie — dla prywatnej apki jak JARVIS są
  **nieistotne** (0 zł). Status przejścia CTF→CTC jest wg Apple wciąż „planowany” na 2026,
  ale Ciebie to nie dotyczy.
- **Poza UE** alternatywne sklepy i Web Distribution oficjalnie nie działają — zostają
  Sideloadly/AltStore/SideStore (darmowe Apple ID, 7 dni) lub TrollStore (stare iOS).

---

## Wariant z Makiem / płatnym kontem (dla kompletności)
- **TestFlight** (Apple Developer, 99 $/rok): najwygodniej dla odbiorcy — instaluje aplikację
  TestFlight i klika link. Build żyje 90 dni. To link, nie plik.
- **Ad-hoc + InstallOnAir/Diawi**: dosłownie jeden `.ipa` za linkiem „dotknij, by zainstalować”,
  ważny ~1 rok — ale najpierw musisz zebrać **UDID** urządzeń (do 100/rok).

Więcej technicznych szczegółów (xcodebuild, ExportOptions.plist, fastlane, podpisywanie w CI)
znajdziesz w [`JARVIS-iOS/INSTALL.md`](JARVIS-iOS/INSTALL.md).

---

## Najszybszy przepis (TL;DR)
1. Pobierz `JARVIS-unsigned.ipa` z **Actions → Artifacts**.
2. **W UE, bez komputera** → zainstaluj **AltStore PAL** lub **SideStore**, dodaj plik.
3. **Poza UE** → **Sideloadly** (raz potrzebny PC) albo **AltStore Classic**.
4. **Stary iPhone (iOS ≤ 17.0)** → **TrollStore** = instalacja na stałe.
5. Na telefonie: zaufaj certyfikatowi i włącz **Tryb programisty**.

---

### Źródła
- DMA / UE / Web Distribution — https://developer.apple.com/support/dma-and-apps-in-the-eu/
- Core Technology Fee / Commission — https://developer.apple.com/support/core-technology-fee/
- AltStore PAL (autoryzacja, darmowość) — https://www.macrumors.com/2024/04/17/altstore-eu-alternative-app-marketplace/ , https://9to5mac.com/2024/08/15/altstore-pal-free/
- SideStore — https://sidestore.io/ , https://docs.sidestore.io/docs/faq
- Sideloadly — https://sideloadly.io/faq.html
- TrollStore (wspierane wersje iOS) — https://github.com/opa334/TrollStore
- TestFlight — https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- Limity kont Apple — https://developer.apple.com/support/compare-memberships/
