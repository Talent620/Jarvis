# JARVIS

Futurystyczny asystent głosowo-tekstowy w stylu HUD. To repozytorium zawiera gotowy
pakiet Android (`JARVIS (1).apk`) oraz infrastrukturę do zbudowania wersji **iOS**.

## Warianty iOS

W repo są **dwa** niezależne podejścia do iOS — wybierz wedle potrzeb:

| Wariant | Gdzie | Co to jest | Build |
|---|---|---|---|
| **Capacitor (główny)** | `ios/`, `capacitor.config.json`, `package.json` | Ten sam frontend co w APK „ubrany” w natywną powłokę iOS (Capacitor) | `.github/workflows/ios.yml` → artefakt `JARVIS-unsigned.ipa` |
| **Natywny SwiftUI (bonus)** | `JARVIS-iOS/` | Samodzielna reimplementacja w SwiftUI (offline, bez sieci) | `.github/workflows/ios-native.yml` → `JARVIS-native-unsigned-ipa` |

Instrukcja instalacji `.ipa` na iPhone **bez Maca** (sideloading, EU/DMA): **[INSTALL.md](INSTALL.md)**.

Klucze licencyjne (offline, Ed25519 — aktywacja aplikacji kluczem): **[LICENSING.md](LICENSING.md)**.

## Jak powstaje wersja Capacitor iOS

Źródło frontendu (React/Vite) **nie znajduje się w tym repozytorium** — dostępny jest
wyłącznie skompilowany frontend zapakowany w `JARVIS (1).apk`. Pipeline:

1. `npm run build` odtwarza `dist/` z pakietu APK (frontend bez zmian),
2. `npx cap sync ios` kopiuje `dist/` do natywnego projektu w `ios/`,
3. `xcodebuild` tworzy niesygnowane archiwum i pakuje je do `JARVIS-unsigned.ipa`.

Cała kompilacja iOS odbywa się na runnerze **macOS** w GitHub Actions (brak lokalnego Maca).

## ⚠️ Bezpieczeństwo — ważne

Skompilowany frontend (w APK / `dist/assets/index-DjclbGPT.js`) zawiera **zaszyty na
sztywno klucz API Groq** (`gsk_…`). To poważny problem bezpieczeństwa istniejącej
aplikacji — klucz w bundlu klienta jest jawny dla każdego, kto pobierze APK/`.ipa`.

Dlatego:
- katalog `dist/` **nie jest wersjonowany** w gicie (CI odtwarza go z APK przy buildzie),
  aby plaintext klucza nie trafił do historii repozytorium;
- **zalecenie:** natychmiast **zrotuj (unieważnij) ten klucz Groq** w panelu Groq i
  przenieś wywołania LLM na własny backend/proxy, zamiast trzymać klucz w aplikacji
  klienckiej. Bez tego każdy może go wykorzystać na Twój koszt.

## Struktura

```
.
├── JARVIS (1).apk            # gotowy build Android (zawiera skompilowany frontend)
├── package.json              # powłoka Capacitor (core/cli/ios/app-launcher)
├── capacitor.config.json     # appId net.serwer256.jarvis, webDir dist
├── scripts/build-web.mjs     # odtwarza dist/ z APK (brak źródła React)
├── ios/                      # natywny projekt iOS (Capacitor) + Info.plist z uprawnieniami
├── JARVIS-iOS/               # alternatywna, natywna apka SwiftUI
├── INSTALL.md                # instalacja .ipa na iPhone bez Maca (2026)
└── .github/workflows/        # ios.yml (Capacitor) + ios-native.yml (SwiftUI)
```
