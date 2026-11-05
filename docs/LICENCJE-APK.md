# Własne licencje APK i desktop

Nowa para jest generowana **na Twoim komputerze** podczas lokalnej instalacji. Klucz prywatny trafia do `${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/license-issuer/private.jwk.json` (uprawnienia 0600). Publiczna część trafia do ignorowanego `license-public.local.json` w repozytorium i jest używana przy budowie desktopu i APK. Następne instalacje ponownie używają tej samej pary; instalator nie nadpisuje innego wystawcy.

Wymagane na Linux: Git, Node.js >=20, npm, działająca sesja graficzna i biblioteki Electron. Instalator pobiera zależności projektu przez `npm ci`, buduje kod i uruchamia Electron z jego normalnym sandboxem. Nie instaluje pakietów systemowych, usług ani modeli.

```bash
git clone --branch codex/apk-license-qa-20261105 https://github.com/Talent620/Jarvis.git "$HOME/Jarvis-licencje"
cd "$HOME/Jarvis-licencje"
npm run install:local -- --desktop
```

Jeśli katalog już istnieje, nie klonuj na niego ponownie. W dotychczasowej kopii tej gałęzi najpierw zachowaj swoje zmiany, następnie wykonaj `git pull --ff-only` i `npm run install:local -- --desktop`.

## Wydanie klucza w JARVIS-ie

1. Na ekranie aktywacji wybierz **Panel właściciela — klucze APK**. W aktywnej aplikacji: **Centrum → Licencje APK**.
2. Wybierz swój plik `private.jwk.json`. Podpis kryptograficzny potwierdzi, że jesteś wystawcą tego buildu. Nie jest potrzebne stare hasło autora. Klucz pozostaje tylko w pamięci tej sesji panelu, a po zamknięciu importujesz go ponownie.
3. Wpisz nazwę odbiorcy i liczbę dni: np. 30, 365 albo 0 dla licencji bezterminowej. Wybierz **Generuj klucz licencyjny APK**.
4. Skopiuj pełny token z widocznego pola. Wklej go do ekranu aktywacji APK lub desktopu zbudowanego z **tym samym kluczem publicznym**. Pierwszy klucz możesz wystawić samemu sobie przed aktywacją desktopu.

Nowy wystawca nie aktywuje starszych APK z cudzą parą. Najpierw zbuduj i zainstaluj swoją wersję. Prywatnego pliku nie dodawaj do Git i nie wysyłaj klientom; odbiorcy dostają wyłącznie token licencji. Zachowaj bezpieczną kopię prywatnego pliku — publiczna część nie pozwala go odtworzyć.

## Budowanie i instalacja APK

Wymagane dodatkowo: JDK >=17 (zalecane 17), Android SDK z platformą projektu, build-tools i zaakceptowanymi licencjami. Ustaw `ANDROID_HOME` lub `ANDROID_SDK_ROOT`. Do instalacji przez USB: `platform-tools/adb`, debugowanie USB i autoryzowany telefon.

```bash
npm run install:local -- --apk --check
npm run install:local -- --apk
# Opcjonalna instalacja na podłączonym telefonie:
npm run install:local -- --apk --install
```

Wynik: `android/app/build/outputs/apk/release/app-release.apk`. Przy kilku telefonach dodaj `--serial IDENTYFIKATOR`. Numer APK rośnie według bieżącego czasu; można jawnie podać `JARVIS_BUILD_NUMBER`. Instalator nie odinstalowuje starej aplikacji ani nie czyści jej danych. Zgodność podpisu instalacyjnego Androida jest niezależna od klucza licencyjnego i musi odpowiadać dotychczasowej instalacji.

## CLI i aktualizacje

```bash
npm run license:init
npm run license -- sign "Jan Kowalski" 30
npm run license -- sign "QA lokalne" 1 --output qa-license.local
npm run license -- trial "Tester" 14
```

`license:init` nie zmienia istniejącej pary. Obsługuje `--key-dir KATALOG` i `--public-file PLIK`. Eksport tokenu przez `--output` odmawia nadpisania istniejącego pliku. `inspect TOKEN` weryfikuje rzeczywisty podpis z publicznym plikiem, zanim poda status.

Własne buildy nie stosują oficjalnego OTA ani instalatora o innym wystawcy. Aktualizuj je ponownie przez `install:local`, zachowując prywatny plik i publiczną konfigurację. Zwykły `npm run build` także odczytuje `license-public.local.json`; alternatywnie ustaw `JARVIS_LICENSE_PUBLIC_KEY_FILE`. Plik wejściowy z sekretem `d` jest odrzucany. Przy aktywacji online serwer licencji również musi używać Twojej publicznej pary; lokalny wariant domyślnie działa na podpisie offline.

Repozytorium zachowuje obecny publiczny klucz autora. Jest poprawny i nie został zastąpiony starszą parą w celu naprawy testów. Do wydawania własnych licencji potrzebujesz swojej pary, dlatego **własne APK buduj po inicjalizacji wystawcy**, przez powyższy instalator. Publikacja kodu na gałęzi GitHub nie oznacza publikacji APK z Twoim wystawcą ani dodania Twojego klucza prywatnego do CI.

## Sprawdzenie

```bash
npm run qa:license
npm run qa:agent:real -- --ollama-url http://127.0.0.1:11435 --model NAZWA_ZAINSTALOWANEGO_MODELU --license-file qa-license.local
```

Pierwszy test używa osobnego, tymczasowego wystawcy, wymaga normalnej aktywacji i sprawdza UI, podpis oraz ponowny start. Nie jest testem fizycznego APK ani autonomii modelu. Drugi jest aliasem istniejącego qa:desktop: A to prawdziwy model i plik, B to STOP i nowe zadanie, C to docelowy pulpit. Pełny schowek i fokus nadal nie mają kompletnej automatyzacji. Brak modelu nie blokuje niezależnych testów komend, ustawień i odtwarzania danych. Runner nie pobiera modelu ani nie wyłącza licencji. Wyniki trafiają do `QA/runs/<run-id>`; kod 2 oznacza blokadę lub nieuruchomiony zakres.
