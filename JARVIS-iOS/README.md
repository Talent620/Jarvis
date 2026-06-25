# JARVIS — iOS

Natywna aplikacja iOS (SwiftUI) odtwarzająca asystenta **JARVIS** — futurystycznego
asystenta głosowego i tekstowego w stylu HUD. To iOS-owy odpowiednik istniejącej
aplikacji Android (`JARVIS.apk`, zbudowanej w Capacitor).

## Funkcje

- 🧠 **Umysł** — rozmowa tekstowa i głosowa z JARVIS-em (lekki parser intencji po polsku, bez sieci)
- ✅ **Zadania** — lista zadań do zrobienia
- 📝 **Notatki** — szybkie notatki z tytułem i treścią
- 🔔 **Przypomnienia** — przypomnienia z terminem (rozumie „jutro", „za 2 godziny", „o 15:30")
- 📅 **Kalendarz** — wydarzenia pogrupowane wg dnia
- 🛒 **Zakupy** — lista zakupów
- ⚙️ **Ustawienia** — imię użytkownika, sterowanie głosem, statystyki pamięci, czyszczenie danych
- 🌈 **Reaktywny rdzeń** — animowany „Rdzeń JARVIS", który zmienia barwę wraz z wykrytym nastrojem
- 🎙️ **Głos** — rozpoznawanie mowy (Speech, pl-PL) + synteza mowy (AVSpeechSynthesizer, pl-PL)

Wszystkie dane są przechowywane lokalnie na urządzeniu (UserDefaults + Codable).

## Polecenia głosowe / tekstowe (przykłady)

```
dodaj zadanie kup mleko
zanotuj pomysł na prezentację
przypomnij mi o spotkaniu jutro o 15:30
dodaj do listy zakupów chleb
dodaj wydarzenie wizyta u lekarza jutro o 10
która godzina
ile to 12 razy 8
mam na imię Marcin
```

## Wymagania

- Xcode 16+
- iOS 17.0+
- Konto deweloperskie Apple do uruchomienia na fizycznym urządzeniu
  (mikrofon i rozpoznawanie mowy działają tylko na urządzeniu / w odpowiednim symulatorze)

## Instalacja na iPhone z jednego pliku (`.ipa`)

Pełny przewodnik (TestFlight, sideloading AltStore/Sideloadly, ad‑hoc, TrollStore,
darmowe vs płatne Apple ID, EU/DMA) jest w **[INSTALL.md](INSTALL.md)**.
Każdy push buduje też appkę na macOS przez GitHub Actions
([`.github/workflows/ios.yml`](../.github/workflows/ios.yml)) i wrzuca artefakt
`JARVIS-unsigned.ipa` (Actions → iOS build → Artifacts).

## Uruchomienie

1. Otwórz `JARVIS.xcodeproj` w Xcode.
2. Wybierz target **JARVIS** i symulator lub urządzenie.
3. ⌘R, aby zbudować i uruchomić.

Przy pierwszym użyciu głosu system poprosi o zgodę na mikrofon i rozpoznawanie mowy
(opisy uprawnień są skonfigurowane w ustawieniach budowania, sekcja `INFOPLIST_KEY_*`).

## Struktura

```
JARVIS/
├── JARVISApp.swift          # punkt wejścia, wstrzykuje AppStore + Assistant
├── Theme.swift              # system designu HUD (kolory, czcionki, panele)
├── Models/Models.swift      # modele danych + moduły + nastroje
├── Store/AppStore.swift     # warstwa stanu i trwałości (UserDefaults/JSON)
├── Assistant/
│   ├── Assistant.swift      # parser poleceń po polsku + odpowiedzi
│   └── SpeechManager.swift  # STT (Speech) + TTS (AVSpeechSynthesizer)
├── Components/              # CoreView (rdzeń), wspólne komponenty UI
└── Views/                  # ekrany modułów (Umysł, Zadania, Notatki, ...)
```

## Uwagi

- `PRODUCT_BUNDLE_IDENTIFIER` ustawiono na `net.serwer256.jarvis`, tak jak w wersji Android.
  Aby uruchomić na własnym koncie, zmień identyfikator i zespół podpisujący w ustawieniach targetu.
- Parser intencji jest celowo lekki i działa offline. Można go rozbudować o integrację
  z API modelu językowego w `Assistant.respond(to:store:)`.
