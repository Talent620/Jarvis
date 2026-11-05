# Kontynuacja QA — 5 listopada 2026

Wykonano pierwsze pełne, niezależnie sprawdzone zadanie przez JARVIS-a: **D1 PASS, poziom B, komenda deterministyczna i rzeczywisty lokalny zapis**. Nie zaliczono na tej podstawie żadnego scenariusza S1–S8 ani autonomii modelu. Pozostały konkretne blokady środowiska oraz luki implementacji i pokrycia testowego.

## Co rzeczywiście uruchomiono

- Repo `/workspace/Jarvis`, gałąź `work`, commit `b3234ca906305712ade35363cffc3524c9a1b21a`, wersja źródeł 2.0.0, niezacommitowane zmiany. Pełny odcisk uruchomionych źródeł: [source.json](evidence/smoke/source.json). Wcześniejsze zmiany zachowano. Brak push i publikacji.
- Środowisko chmurowe, Debian 13, Node 24.22.1, Electron 33.4.11, Playwright 1.62.1, systemowy Chromium. Nie jest to `/home/qw/Jarvis-GitHub`. Brak DISPLAY, WAYLAND_DISPLAY, XDG_RUNTIME_DIR, adresu i socketu sesyjnego D-Bus, Xvfb oraz xdotool. Obecność Xorg nie oznacza działającej sesji. [Dane](evidence/smoke/environment.json).
- Webowy JARVIS uruchomiony przez Vite w izolowanym profilu, z identyfikatorem buildu/przebiegu `2026-11-05T19-34-42-012Z-agent-smoke-38326065`. Licencja wyłączona wyłącznie w tym serwerze deweloperskim. Bundle dist zbudowano oddzielnie ze zwykłymi ustawieniami. Nie użyto profilu, historii, CRM ani schowka użytkownika.

## Rzeczywiste zadanie D1

Runner wpisał w normalne pole rozmowy `Dodaj zadanie: ORION <run-id> — sprawdź żółć, ąę i zapis`. JARVIS przeszedł przez `askJarvis`, bramkę `requestConsent` i istniejący wykonawca `add_task`. Powstało zadanie, wpis audytu oraz odpowiedź i historia rozmowy. Runner **tylko odczytał** trwały zapis localStorage, następnie zamknął proces Chromium i uruchomił nowy proces z tym samym własnym profilem. Sprawdził dokładną treść, jeden wpis oraz zachowanie historii. Nie wywołano modelu, nie podstawiono odpowiedzi i nie utworzono zadania z poziomu skryptu testowego.

[Zrzut UI](evidence/smoke/D1-ui.png), [zapis przed restartem](evidence/smoke/D1-before-restart.json), [po restarcie](evidence/smoke/D1-after-restart.json), [brak żądań do modelu](evidence/smoke/model-requests.json). Ten restart sprawdza trwałość zakończonej komendy, nie wznowienie przerwanego celu z S8.

## S1–S8

| Scenariusz | Poziom | Wynik | Dowód i ograniczenie |
|---|---|---|---|
| S1 rozmowa z modelem | D | BLOCKED | Oba lokalne API odmawiają połączenia. [ollama.json](evidence/smoke/ollama.json). Brak generacji i odpowiedzi modelu. |
| S2 projekt + README | D/C | NOT_RUN | D1 nie tworzy projektu i README. Brak pełnego przebiegu/orakla w smoke; plikowy mostek wymaga Electron. |
| S3 strona, klik, zapis | D/C | NOT_RUN | Adapter publicznego GET nie implementuje klikania DOM. Nie zastąpiono tego klikaniem przez runner. |
| S4 kalkulator i okno | C/D/E | NOT_RUN | Nie uruchomiono polecenia do agenta. Start Electron BLOCKED; brak sesji i modelu. Nie użyto `/usr/bin/true`. |
| S5 zaznacz, kopiuj, edytor, zapisz | C/D/E | NOT_RUN | Brak pełnego wykonawcy/orakla. Znane ograniczenia fokusu, X11/ASCII; nie podmieniono schowka zapisem pliku. |
| S6 wygenerowany konwerter w izolacji | D | NOT_RUN | Wykonawca generowanego kodu pozostaje zablokowany bez sandboxa. Ogólny terminal nie zalicza izolacji. |
| S7 wyniki i STOP podczas pracy | D | NOT_RUN | Naprawiono i sprawdzono kontrolki na poziomie A. Brak pomiaru rzeczywistego wieloetapowego agenta i jego efektów; wcześniejsze fixture UI nie zaliczają S7. |
| S8 restart w trakcie celu | D/C | NOT_RUN | D1 dowodzi zachowania już zapisanego zadania. Nie sprawdza przerwania celu ani idempotencji wszystkich skutków. |

Maszynowy wynik i lista konkretnych defektów G1–G5: [results.json](results.json). NOT_RUN oznacza nieuruchomiony pełny scenariusz. Brak implementacji nie jest ukryty pod ogólnym opisem „brak środowiska”. Macierz wcześniejszych 60 testów pozostaje bez nowych zaliczeń na podstawie D1.

## Diagnostyka Ollamy i Electron

Prywatny profil użytkownika nie jest dostępny. Nie przedstawiono domyślnego adresu ze źródeł jako jego konfiguracji. Bez jawnego ustawienia wykonano `GET http://127.0.0.1:11435/api/tags` oraz `GET http://127.0.0.1:11434/api/tags`, każde z limitem 3000 ms: **ECONNREFUSED dla obu**. Nie wybrano żadnego serwera ani modelu. Faktycznie użyty profil webowy ma `ollamaUrl: ""`, provider `ollama`, model `auto`, tryb wyłącznie lokalny; [odczyt ustawień](evidence/smoke/effective-app-settings.json). Nie jest to ustawienie produkcyjne. Brak programu ollama w PATH nie był podstawą diagnozy.

Do odblokowania S1 i testu D2 trzeba uruchomić runner na maszynie z istniejącym API oraz wskazać zainstalowany model. Kolejne etapy są osobne: poprawne tags → model → metadane/tools → rzeczywista generacja → normalny czat → rzeczywista operacja narzędzia. Tutaj wykonanie zatrzymało się na osiągalności API. Nie pobrano modeli, nie użyto chmury i nie wystawiono API publicznie.

`npm run qa:desktop` rzeczywiście uruchomił `node_modules/electron/dist/electron .` z prywatnym profilem i workspace, bez flag wyłączających sandbox. Proces zakończył się SIGSEGV po błędzie `Missing X server or $DISPLAY`, przed załadowaniem renderera. Osobne próby `--ozone-platform=headless` oraz Ozone + dołączony SwiftShader również zakończyły się SIGSEGV podczas inicjalizacji grafiki. To wykonane, nieudane próby diagnostyczne, nie PASS. [Pierwszy stderr](evidence/desktop/electron-stderr.log), [headless](evidence/headless/electron-stderr.log), [SwiftShader](evidence/swiftshader/electron-stderr.log).

Warstwa C pozostaje BLOCKED przez brak działającego środowiska graficznego dla tej wersji Electron. Użytkownik wybrał **bez instalacji — sprawdzę Electron lokalnie**. Nie instalować Xvfb. Odblokowanie: `qa:desktop` w lokalnej sesji graficznej użytkownika. Wariant runnera z istniejącym Xvfb/sesją został zaimplementowany, lecz nie został tutaj wykonany. Normalna bramka licencji w Electron: NOT_RUN. Warstwa E wymaga rzeczywistej sesji użytkownika; chmurowy X11 nie potwierdzi działania Wayland.

## Zmiany i regresje

- Ogólne lokalne komendy `Dodaj zadanie: …` i `Dodaj notatkę: …` korzystają z istniejących narzędzi i audytu, bez modelu. Nazwy ORION/QA nie mają specjalnego znaczenia w kodzie aplikacji. STOP jest sprawdzany przed wykonaniem.
- `hasUsableBrain` nie uznaje samego wyboru modelu za konfigurację zdatną do próby połączenia, respektuje przekazane ustawienia i tryb lokalny. Pasek oznacza model jako „WYBRANY”, a ONLINE jako stan sieci, bez deklarowania sprawności agenta.
- „Pokaż dotychczasowe wyniki” jest rozpoznawane i przechodzi przez composer podczas busy, bez blokowania STOP i bez rozpoczynania nowego zwykłego zadania.
- Dodano `qa:preflight`, `qa:agent:smoke`, `qa:desktop`, przypięto Playwright oraz izolowane ścieżki profilu/workspace/bundle w Electron. Domyślny sandbox i izolacja renderera pozostają aktywne.
- Poprawiono zawijanie nagłówka klasycznego, aby nie ucinał nazwy JARVIS. Końcowy smoke wymaga odsłoniętego pola rozmowy, normalnego kliknięcia, pełnej widocznej odpowiedzi i pola pozostającego w ekranie. [Geometria](evidence/smoke/D1-layout.json).
- Początkowy błąd runnera wynikał z traktowania audytu tekstowego JSON jako obiektu. Poprawiono deserializację; asercje dokładnej treści, statusu i jednego skutku zachowano.

Dwie regresje wykryte w kodzie odtworzono testami przed poprawką: [FAIL przed](evidence/controls-before.log) → [23 PASS po, z powiązanymi testami](evidence/controls-after.log). Pełny zestaw: **2901 PASS / 2 FAIL, 354 pliki**; oba znane błędy z `tests/license.test.ts`, bez zmian w weryfikacji licencji ani osłabiania asercji. [Log](evidence/all-tests.log). [Lint PASS](evidence/lint.log), [build PASS](evidence/build.log); pozostało ostrzeżenie rozmiaru chunka. Testy z atrapami nie są liczone jako scenariusze autonomii. Lista zmienionych plików tej iteracji: [iteration-files.txt](iteration-files.txt).

## Powtórzenie i wycofanie

Po zainstalowaniu zależności projektu (`npm ci`, bez instalacji systemowej) i z istniejącym Chromium:

```bash
npm run qa:preflight -- --ollama-url http://127.0.0.1:11435 --model NAZWA_JUZ_ZAINSTALOWANEGO_MODELU
npm run qa:agent:smoke -- --ollama-url http://127.0.0.1:11435 --model NAZWA_JUZ_ZAINSTALOWANEGO_MODELU
npm run qa:desktop
```

Model należy wskazać spośród listy faktycznie zwróconej przez preflight. Bez serwera można uruchomić `npm run qa:agent:smoke` dla D1; kod wyjścia 2 zachowuje informację o zablokowanym S1 i nieuruchomionych S2–S8. Te trzy polecenia są zaimplementowane i zostały wykonane w tej maszynie. Nie są jeszcze pełnym lokalnym wykonawcą wszystkich ośmiu scenariuszy. Szczegóły wymagań i zakresu: [instrukcja runnerów](../../../scripts/qa/README.md).

Zwykłe uruchomienie bieżących źródeł na pulpicie: `npm run build && npm run electron:dev`. Nie używać testowego profilu ani wyłączenia licencji dla instalacji użytkownika. Bez publikacji tych zmian nie ma ich jeszcze do pobrania z GitHub.

Zachowano poprzedni patch. Przyrostowy [iteration.patch](iteration.patch) cofa wyłącznie tę iterację do HEAD + poprzednia praca. [Sprawdzenie odwrotnego zastosowania PASS](rollback-check.txt). Po zachowaniu własnej kopii bieżących danych i zmian:

```bash
git apply --check --reverse QA/autonomia60/continuation/iteration.patch
git apply --reverse QA/autonomia60/continuation/iteration.patch
npm run build
```

Jeśli check nie przechodzi po dalszych zmianach, nie wymuszać operacji. Nie używać reset/clean. Profile QA są poza domyślnymi danymi i pozostają w ignorowanym `QA/runs/`; procesy uruchomione przez zakończone runnery zostały zamknięte.
