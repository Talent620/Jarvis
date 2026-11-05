# Smoke test gotowego AppImage

`npm run test:linux-runtime` uruchamia rzeczywisty pakiet Linux, sprawdza automatyczną konfigurację lokalnego serwera, wykonanie zadania po zamknięciu GUI oraz ponowne użycie procesu, tokenu i zapisanego wyniku. Odpowiedzi Ollamy są **symulowane przez lokalny serwer HTTP**. Ten test nie ocenia jakości modelu, GPU ani integracji chmurowych.

Potrzebne są Linux, Node.js 20+, gotowy osobisty AppImage, sesja graficzna lub Xvfb oraz sterownik Electron z Playwright. Zależność testowa może być zainstalowana poza projektem:

```bash
npm install --prefix /tmp/jarvis-smoke-driver --no-save --no-package-lock --ignore-scripts --no-audit --no-fund playwright@1.57.0
JARVIS_PLAYWRIGHT_MODULE=/tmp/jarvis-smoke-driver/node_modules/playwright/index.mjs \
  xvfb-run -a npm run test:linux-runtime -- ./release-desktop/JARVIS.AppImage
```

W terminalu uruchomionego pulpitu pomiń `xvfb-run -a`. Jeśli Playwright jest już dostępny przez rozwiązywanie modułów Node, nie trzeba ustawiać `JARVIS_PLAYWRIGHT_MODULE`.

Przygotowanie osobistej paczki, jeśli jeszcze jej nie ma:

```bash
JARVIS_LICENSE_REQUIRED=false npm run build
npx electron-builder --linux AppImage --publish never
```

Smoke nie wstrzykuje aktywacji ani nie zmienia licencji gotowej paczki. Workflow [Build Ubuntu](../.github/workflows/ubuntu.yml) ma osobny job `runtime-smoke`: buduje osobisty AppImage z `JARVIS_LICENSE_REQUIRED=false`, instaluje przypięty Playwright 1.57.0 poza projektem i uruchamia test pod Xvfb z sandboxem Electron. Brak obsługi sandboxa powoduje błąd testu; workflow nie przełącza się automatycznie na `--no-sandbox`.

Job `build` zależy od powodzenia smoke i buduje paczki wydawnicze w osobnym środowisku, z dotychczasową domyślną licencją. Job `publish` zależy od `build` i działa tylko dla push do `main`. Uprawnienie `contents: write` ma wyłącznie job publikacji. PR do `main` także przechodzi bramkę smoke; zmiany runtime, skryptów i lockfile uruchamiają ją również przy push do `main`.

Bramka sprawdza zachowanie osobistej paczki z tego samego commita. Nie uruchamia dokładnej paczki licencjonowanej publikowanej przez job `publish` ani jej aktywacji; ten zakres nadal wymaga osobnego testu wydania.

Log i opcjonalny zrzut ekranu sukcesu lub błędu są dostępne przez 7 dni jako artefakt `jarvis-linux-runtime-smoke`. Artefakt nie zawiera katalogu profilu, tokenu ani danych runtime. Wykonanie nowej konfiguracji na GitHub Actions: **NOT_RUN** w tej sesji; poprawność działania konkretnego runnera musi potwierdzić jego pierwszy przebieg. Lokalny test AppImage i walidacja workflow nie zastępują tego wyniku.

Test tworzy prywatny katalog tymczasowy dla profilu aplikacji, danych runtime, XDG i workspace. Izoluje adres sesji D-Bus, aby nie uruchamiać usługi systemd rzeczywistego użytkownika. Po teście zamyka GUI, zatrzymuje własny runtime i usuwa dane tymczasowe; awaryjny sygnał procesu wymaga zgodności jego polecenia i unikalnego katalogu danych. Nie zmienia `HOME`.

Sandbox Electron pozostaje domyślnie włączony. Tylko w ograniczonym kontenerze testowym, który nie obsługuje sandboxa, można jawnie ustawić `JARVIS_SMOKE_NO_SANDBOX=1`; wynik wtedy nie potwierdza działania sandboxa. Opcjonalne `JARVIS_SMOKE_SCREENSHOT=/tmp/jarvis-smoke.png` zachowuje zrzut ekranu. Raport JSON na stdout jawnie oznacza atrapę modelu i nie zawiera tokenu.
