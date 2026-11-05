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

`qa:desktop` próbuje uruchomić prawdziwy Electron. Bez sesji sprawdza Xvfb; jeśli jest dostępny, uruchamia własny serwer przez `-displayfd` bez zgadywania DISPLAY. Bez obu zależności zapisuje stderr rzeczywistej próby startu. W działającej sesji buduje własne dwa bundle poza dist: normalny z bramką licencji i testowy bez licencji. Sprawdza normalną bramkę, następnie rzeczywistą komendę lokalną w Electron. Izolację zachowuje przez `JARVIS_PROFILE_DIR`, `JARVIS_WORKSPACE_DIR` i wyłącznie deweloperski `JARVIS_QA_RENDERER_DIR`. Wariant z działającym ekranem nie został potwierdzony w środowisku chmurowym bez ekranu.

Po zakończeniu runner zamyka własne procesy. Logi i profile pozostają do inspekcji i są ignorowane przez Git. Usuwać można wyłącznie wybrany katalog danego przebiegu po zachowaniu potrzebnych dowodów. Instalacja systemowa i naprawa systemowego helpera sandboxa wymagają decyzji administratora; runner ich nie wykonuje.

Pełny S4/S5 wymaga rzeczywistego okna, poprawnego fokusu, systemowego schowka i niezależnego odczytu pliku; wirtualny X11 nie dowodzi działania Wayland. S6 wymaga jeszcze izolowanego wykonawcy generowanego kodu. S7/S8 wymagają uruchomienia rzeczywistego zadania wieloetapowego i orakli efektów. Te luki pozostają defektami zakresu funkcjonalnego/testowego, a nie dowodami PASS.
