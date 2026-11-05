# JARVIS QA — rzeczywiste działanie, oddzielone poziomy

Wymagane: Node >=20, zależności projektu (`npm ci`), istniejący Chromium albo `--chromium /ścieżka/do/chromium`. Playwright jest przypięty w lockfile. Runner nie pobiera przeglądarki ani modelu, nie instaluje pakietów systemowych i nie publikuje zmian.

```bash
npm run qa:preflight
npm run qa:agent:smoke
npm run qa:desktop
```

Każdy przebieg tworzy prywatny katalog `QA/runs/<run-id>/`: report.json, REPORT.md, odcisk źródeł, logi i odrębne dane/profil. Kody wyjścia: 0 = wykonany zakres zaliczony, 1 = FAIL, 2 = BLOCKED lub NOT_RUN. `qa:desktop` zalicza wyłącznie własny zakres startu i komendy lokalnej, nie S1–S8.

Adres i model można podać jawnie:

```bash
npm run qa:preflight -- --ollama-url http://127.0.0.1:11435 --model NAZWA_JUZ_ZAINSTALOWANEGO_MODELU
npm run qa:agent:smoke -- --ollama-url http://127.0.0.1:11435 --model NAZWA_JUZ_ZAINSTALOWANEGO_MODELU
```

Alternatywa: `--settings-file /ścieżka/settings.json`. Obsługiwany jest obiekt ustawień, `{settings: ...}` albo eksport klucza `jarvis.settings.v2` (także string JSON). Runner odczytuje tylko adres i wybór modelu; nie przenosi kluczy, historii, CRM ani zgód do profilu testowego. Plik nie jest automatycznie tworzony z prywatnego profilu Electron. Kolejność wyboru: CLI > QA_OLLAMA_URL / QA_OLLAMA_MODEL > plik. Raportuje źródło ustawienia. Bez adresu sprawdza oba znane porty: 11435 i 11434. Nie zakłada 11434 na podstawie PATH. Model należy wybrać spośród rzeczywiście zainstalowanych; runner nie zgaduje modelu ani nie pobiera go.

`qa:agent:smoke` uruchamia Vite tylko na loopback i Chromium z sandboxem. Przepuszcza niezmienione żądania do własnego UI i wybranego lokalnego API; inne kierunki blokuje. Nie podmienia odpowiedzi modelu. Wyłącza licencję jedynie dla tej izolowanej instancji deweloperskiej, nigdy w dist ani konfiguracji użytkownika.

- D1 [B]: zwykły composer → `askJarvis` → istniejący `runTool/add_task` → rzeczywisty trwały zapis. Czyta bezpośrednio zapisane dane i audyt, zamyka proces Chromium, uruchamia nowy proces z tym samym własnym profilem i sprawdza brak duplikatu oraz historię. Komenda `Dodaj zadanie: ...` została dodana jako ogólna funkcja offline, bez specjalnych nazw QA. To nie zalicza S2 ani S8.
- S1 [B/D]: jeżeli istnieje API i jawnie wybrany zainstalowany model: rzeczywista generacja, normalna rozmowa w UI, sprawdzenie odpowiedzi, pochodzenia i zapisanej historii. Osobny D2 sprawdza rzeczywisty dobór `add_task` przez model i jego efekt. Samo HTTP 200 nie zalicza tych etapów.
- S2–S8: ten smoke nie ma jeszcze pełnych wykonawców/orakli tych scenariuszy; zapisuje NOT_RUN. Wyniki testów jednostkowych i D1 nie zastępują brakującego pokrycia.

`qa:desktop` jest wspólnym wejściem dla niezależnych testów UI oraz istniejących scenariuszy z rzeczywistym modelem. `qa:agent:real` jest teraz jego aliasem. Definicja w package.json: `node scripts/qa/desktop.cjs`.

```bash
npm run qa:desktop
npm run qa:desktop -- --ollama-url http://127.0.0.1:11435 --model NAZWA_JUZ_ZAINSTALOWANEGO_MODELU
npm run qa:desktop -- --settings-file /sciezka/minimalne-ustawienia.json
```

Brak modelu nie blokuje odrębnego testu Chromium: normalna aktywacja z tymczasowym wystawcą, komenda lokalna, zmiana ustawienia przez UI i odtworzenie tego samego zadania, audytu oraz historii po zamknięciu całego procesu przeglądarki. To rzeczywisty lokalny zapis przez JARVIS-a, ale nie dowód działania modelu lub pulpitu. Licencja pozostaje wymagana. Testowy klucz i profil są tylko w ignorowanym katalogu przebiegu; ustawienia produkcyjne, plik wystawcy użytkownika i jego licencja nie są zmieniane.

Następnie runner próbuje uruchomić prawdziwy Electron z sandboxem. Nie instaluje ani nie uruchamia Xvfb i nie ustawia wymyślonego DISPLAY. Bez sesji zapisuje rzeczywisty stderr i etap awarii. W dostępnej sesji buduje normalnie licencjonowany testowy bundle poza dist, aktywuje go, sprawdza komendy lokalne i restart Electron. Domyślnie używa tymczasowego wystawcy testowego; opcjonalne `--license-file PLIK` używa dostarczonego tokenu i zwykłej konfiguracji wystawcy. Token nie jest wypisywany w raporcie. Izolacja: `JARVIS_PROFILE_DIR`, `JARVIS_WORKSPACE_DIR`, deweloperski `JARVIS_QA_RENDERER_DIR`.

A wymaga prawdziwej Ollamy, zwykłego composera, zapisu i odczytu pliku przez narzędzia JARVIS-a i osobnego sprawdzenia dysku. B obejmuje STOP rzeczywistego żądania, obserwację wyciszenia wykonawcy, rozliczenie wcześniejszych efektów, nową generację i nowy plik ze świeżą zgodą. Logi wiążą żądania z poleceniem, nie tylko z chwilą nadejścia odpowiedzi. Moment zatrzymania kernela modelu nie jest wywodzony z anulowania HTTP. C, pełne zaznaczenie/schowek/fokus/edytor, nadal nie ma kompletnej automatyzacji i orakla. Bez pulpitu ma konkretny blocker; w dostępnej sesji pozostaje NOT_RUN.

Raport rozdziela `runner_completed` od `required_tests_passed`. Kod 2 oznacza, że główne A–C nie zostały wszystkie zaliczone, nawet jeśli testy niezależne mają PASS. Kod 1 oznacza FAIL. Raport powstaje także przy brakujących zależnościach, blokadzie startu, błędzie flag i przerwaniu. Natywnego wariantu z działającym ekranem i modelem nie potwierdzono w tej chmurze. Wymagane: Node >=20, `npm ci`, Chromium dla testów webowych, poprawnie zainstalowany Electron z bibliotekami i sandboxem oraz autoryzowana sesja graficzna dla natywnych. Runner nie pobiera modeli i nie przełącza się na chmurę.

Po zakończeniu runner zamyka własne procesy. Logi i profile pozostają do inspekcji i są ignorowane przez Git. Usuwać można wyłącznie wybrany katalog danego przebiegu po zachowaniu potrzebnych dowodów. Instalacja systemowa i naprawa systemowego helpera sandboxa wymagają decyzji administratora; runner ich nie wykonuje.

Pełny S4/S5 wymaga rzeczywistego okna, poprawnego fokusu, systemowego schowka i niezależnego odczytu pliku; wirtualny X11 nie dowodzi działania Wayland. S6 wymaga jeszcze izolowanego wykonawcy generowanego kodu. S7/S8 wymagają uruchomienia rzeczywistego zadania wieloetapowego i orakli efektów. Te luki pozostają defektami zakresu funkcjonalnego/testowego, a nie dowodami PASS.
