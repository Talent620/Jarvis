# JARVIS 2.1.0-alpha.2 — budowanie i identyfikacja

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
`release-desktop/2.1.0-alpha.2-<skrót SHA>/`. Wymaga licencji, zachowuje domyślnego
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
`codex/durable-autonomy-*` i `codex/skills-integration-*`; wynik znajduje się w artefakcie `jarvis-linux`. Tag prerelease `v<wersja package.json>` uruchamia tę samą weryfikację i publikację paczek jako prerelease, bez zmiany `latest`.
Przed publikacją sprawdź pełny SHA oraz wyniki CI. Obecny workflow produkcyjny
Android publikuje rolling `latest` tylko z `main`; tag alpha go nie uruchamia.

Publikuj alpha jako prerelease z raportem ograniczeń, rzeczywistymi paczkami,
`PROVENANCE.json` i `SHA256SUMS`. Po publikacji pobierz paczki z adresów wydania
i ponownie sprawdź sumy. Brak dostępu API GitHub oznacza brak potwierdzonego
Release, nawet jeżeli push kodu się udał. Istniejący workflow może opublikować zatwierdzony tag przy użyciu własnego tokenu CI; wynik trzeba potwierdzić na stronie wydania i przez pobranie plików.

Audyt po kompatybilnych poprawkach zależności: 0 podatności produkcyjnych,
32 w zależnościach sklasyfikowanych przez npm jako deweloperskie, w tym Electron
obecny w paczce desktopowej. Zero w `--omit=dev` nie oznacza braku podatności
w całej aplikacji. Szczegóły i licencje zmian:
`QA/autonomia60/durable/packaging.json`. Aktualizacja narzędzi wymagająca zmiany
głównej wersji pozostaje otwartą pracą; nie ogłaszaj pełnego audytu jako PASS.

## Aktualizacja instalacji z lokalnym kluczem właściciela

Jeżeli wcześniejsza instalacja użyła `install:local`, zbuduj tę wersję z tą samą lokalną parą. Gotowe paczki CI używają wystawcy repozytorium i nie potwierdzą licencji wydanej inną parą. Poniższy przebieg tworzy odrębny checkout, zachowuje istniejący klucz właściciela, buduje `.deb`, aktualizuje zainstalowany pakiet i uruchamia aplikację.

Wymagania: Ubuntu/Debian x86_64, Git, Node.js >=20, npm, sudo i własna działająca sesja graficzna. Zamknij poprzednie okno JARVIS-a przed aktualizacją. Pobranie zależności wymaga internetu. Polecenie nie instaluje Xvfb, Ollamy, modeli ani serwerów integracji.

```bash
bash <<'JARVIS_INSTALL'
set -euo pipefail
for jarvis_tool in git node npm sudo; do
  command -v "$jarvis_tool" >/dev/null || { echo "Brakuje: $jarvis_tool" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("Wymagany Node.js >=20"); process.exit(1); }'
[[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] || { echo 'Uruchom w swojej sesji graficznej.' >&2; exit 1; }
jarvis_source="$(mktemp -d "${TMPDIR:-/tmp}/jarvis-alpha2.XXXXXX")"
chmod 755 "$jarvis_source"
git clone --depth 1 --branch v2.1.0-alpha.2 https://github.com/Talent620/Jarvis.git "$jarvis_source"
cd "$jarvis_source"
node scripts/install-local.cjs --desktop --build-only
./node_modules/.bin/electron-builder --linux deb --publish never
sha256sum release-desktop/JARVIS.deb
sudo apt install --yes "$jarvis_source/release-desktop/JARVIS.deb"
exec jarvis-ai-assistant
JARVIS_INSTALL
```

Nowy `postinst` sprawdza sumę pliku `chrome-sandbox` względem zainstalowanego pakietu oraz własność i uprawnienia katalogów. Następnie ustawia helper na `root:root 4755`. Nie zmienia AppArmor, sysctl ani flag sandboxa. Błąd `_apt` dotyczący odczytu starego katalogu tymczasowego nie był przyczyną awarii startu; dotychczasowy błąd dotyczył uprawnień helpera.

Do lokalnego odbioru z tego checkoutu użyj `npm run qa:desktop -- --ollama-url http://127.0.0.1:11435 --model NAZWA_ISTNIEJACEGO_MODELU`. Podaj rzeczywisty port i już zainstalowany model. Sam runner nie pobiera modeli, nie zmienia konfiguracji produkcyjnej i zapisuje BLOCKED zamiast pełnego sukcesu przy braku wymaganych usług.
