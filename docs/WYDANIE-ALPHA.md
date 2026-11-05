# JARVIS 2.1.0-alpha.1 — budowanie i identyfikacja

To wydanie eksperymentalne. Wyniki rzeczywistego modelu, pulpitu i urządzeń są
oddzielne od testów kodu. Nie zastępuj ich udanym pakowaniem.

## Linux

Na czystej, zatwierdzonej kopii właściwego commitu, po `npm ci`:

```bash
npm test
npm run lint
npm run release:linux
```

Skrypt buduje rzeczywiste `.deb` i AppImage do
`release-desktop/2.1.0-alpha.1-<skrót SHA>/`. Wymaga licencji, zachowuje domyślnego
wystawcę i nie generuje nowej pary. Jeżeli używasz własnego wystawcy, wskaż
zatwierdzony **publiczny** plik przez `JARVIS_LICENSE_PUBLIC_KEY_FILE`; nie
rozprowadzaj takiego pakietu jako aktualizacji dla licencji innego wystawcy.

`PROVENANCE.json` zawiera pełny commit, wersję, znacznik budowania i licencje
zależności. `SHA256SUMS` pozwala sprawdzić pliki przez `sha256sum -c SHA256SUMS`.
Kontrola archiwum odrzuca profile, lokalną konfigurację i pliki kluczy prywatnych.
W aplikacji wersja oraz rozwijany pełny SHA są w Ustawienia → Dane.

Po pobraniu autentycznych paczek i sprawdzeniu sum, AppImage uruchamia się przez
`chmod +x JARVIS.AppImage` oraz `./JARVIS.AppImage`. Instalację `.deb` wykonuje
właściciel komputera przez `sudo apt install ./JARVIS.deb`. Wymagana jest działająca
sesja graficzna i sandbox Electron; nie dodawaj `--no-sandbox`.

Instalacja, migracja danych, aktualizacja i rollback wymagają oddzielnego testu
na docelowym systemie. Przed instalacją zachowaj poprzednią paczkę oraz kopię
profilu przy wyłączonej aplikacji. Powrót do poprzedniej AppImage jest możliwy
przez uruchomienie zachowanego pliku; dla `.deb` użyj poprzedniego pakietu
(`sudo apt install --allow-downgrades ./POPRZEDNI-JARVIS.deb`). Nie zakładaj, że
starsza wersja odczyta wszystkie nowe dane; odtwarzanie kopii profilu wykonuj
świadomie i zachowaj także profil nowej wersji.

Przycisk aktualizacji nadal śledzi publiczne wydanie `latest`; alpha jest
instalowana ręcznie. Sam tag lub ZIP źródeł nie oznacza dostępnego instalatora.

## Android

W repozytorium nie ma produkcyjnego klucza podpisu. Historyczny klucz
deweloperski nie jest już automatycznym fallbackiem. Klucz APK i klucz wystawcy
licencji to oddzielne mechanizmy.

Istniejące workflowy Android wymagają sekretów:

- `JARVIS_RELEASE_KEYSTORE_BASE64`;
- `JARVIS_RELEASE_STORE_PASSWORD`;
- `JARVIS_RELEASE_KEY_ALIAS`;
- `JARVIS_RELEASE_KEY_PASSWORD`.

Wymagane publiczne zmienne repozytorium:

- `JARVIS_RELEASE_CERT_SHA256`: zatwierdzony odcisk istniejącego certyfikatu;
- `JARVIS_PREVIOUS_VERSION_CODE`: numer wersji aktualnie dystrybuowanej aplikacji;
- `JARVIS_BUILD_NUMBER`: większy, nowy numer (maksymalnie 2100000000).

CI sprawdza certyfikat przez `keytool`, zachowuje sekret wyłącznie w prywatnym
katalogu tymczasowym runnera i nie wypisuje haseł. Nie konfiguruje tych wartości
samodzielnie. Brak konfiguracji przerywa budowanie release. Nie odinstalowuj
starej aplikacji, aby ukryć konflikt podpisów.

Workflow `android-v2.yml` buduje jawnie oznaczony **debug** z innym applicationId,
z nadal wymaganą licencją. Nie jest to produkcyjny APK ani aktualizacja JARVIS-a.

## Publikacja

Workflow Ubuntu uruchamia testy i pakowanie na gałęziach
`codex/durable-autonomy-*`; wynik znajduje się w artefakcie `jarvis-linux`.
Przed publikacją sprawdź pełny SHA oraz wyniki CI. Obecny workflow produkcyjny
Android publikuje rolling `latest` tylko z `main`; tag alpha go nie uruchamia.

Publikuj alpha jako prerelease z raportem ograniczeń, rzeczywistymi paczkami,
`PROVENANCE.json` i `SHA256SUMS`. Po publikacji pobierz paczki z adresów wydania
i ponownie sprawdź sumy. Brak dostępu API GitHub oznacza brak potwierdzonego
Release, nawet jeżeli push kodu się udał.

Audyt po kompatybilnych poprawkach zależności: 0 podatności produkcyjnych,
32 w zależnościach sklasyfikowanych przez npm jako deweloperskie, w tym Electron
obecny w paczce desktopowej. Zero w `--omit=dev` nie oznacza braku podatności
w całej aplikacji. Szczegóły i licencje zmian:
`QA/autonomia60/durable/packaging.json`. Aktualizacja narzędzi wymagająca zmiany
głównej wersji pozostaje otwartą pracą; nie ogłaszaj pełnego audytu jako PASS.
