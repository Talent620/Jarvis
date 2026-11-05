# Walidacja Linux i lokalnego serwera — 2026-11-05

Badana gałąź: `codex/linux-pro-new-20261105`. Środowisko testowe: Debian 13, Node 24.22.1, npm 11.9, Chromium oraz Electron 33.4.11. To nie jest test na fizycznym komputerze użytkownika.

## Wyniki

| Zakres | Wynik | Granica dowodu |
| --- | --- | --- |
| `npm test` | 2929 PASS, 338 plików, 0 FAIL/SKIP | Przypadki testowe, nie miara inteligencji |
| `npm run lint` | PASS, bez ostrzeżeń | Obejmuje teraz także `server/runtime` |
| `JARVIS_LICENSE_REQUIRED=false npm run build` | PASS | Vite nadal zgłasza ostrzeżenie o dużych chunkach |
| Runtime HTTP | 27 PASS, zawarte w wyniku Vitest | Prawdziwy serwer i zapis na dysku; model symulowany |
| Kompas E2E | 18 PASS | Osobny podprojekt, test w Chromium |
| Site OS API smoke | PASS | Nie obejmuje pełnego wizualnego smoke Electron |
| Workspace tools | 10 PASS, 2 NOT_RUN | SQLite i PostgreSQL nie zostały sprawdzone |
| Instalator runtime | 20 sprawdzeń PASS | Rzeczywiste CLI; menedżer systemd symulowany |
| Launcher instalowanej aplikacji | 19 sprawdzeń PASS | Start, ponowne użycie procesu, limit czasu i ikona |
| Panel runtime w Chromium | PASS | Rzeczywisty backend HTTP, symulowana Ollama |
| Electron i IPC runtime | PASS | Rzeczywisty proces Electron i prywatny plik połączenia |
| AppImage: jedno uruchomienie | PASS | Gotowa paczka, `APPIMAGE_EXTRACT_AND_RUN=1`; model symulowany |

Nie znaleziono dowodu istnienia 10000 testów. Liczba bloków `describe` raportowana przez Vitest nie jest liczbą dodatkowych przypadków i nie została dodana do wyniku. Historyczne wyniki dotyczą wcześniejszych wersji kodu.

Testy runtime obejmują idempotencję, anulowanie, timeout, wygaśnięcie gotowości, odmowę modelu chmurowego, restart i `SIGKILL` osobnego procesu, brak nowej inferencji po zatrzymaniu, odrzucenie zewnętrznego adresu odzyskiwanego ze stanu, archiwizację z zachowaniem idempotencji i wykonanie 501. zadania. Archiwum zachowuje wyniki poza bieżącym widokiem historii.

Dodatkowe testy startu obejmują wybór już zainstalowanego modelu, automatyczny test odpowiedzi, pierwszeństwo kolejki, blokadę profilu i odzyskanie jej po awarii oraz ochronę wyboru użytkownika przed równoległym CLI/API. Testy konfiguracji czatu sprawdzają zachowanie istniejących kluczy i dostawców, zmian podczas oczekiwania, ręcznie wybranego modelu oraz ograniczenie czasu także dla zawieszonego IPC.

Test przeglądarkowy sprawdził wybór modelu, próbę odpowiedzi, zakończenie zadania po zamknięciu klienta, anulowanie, wyniki po restarcie i usunięcie zielonego statusu przy utracie połączenia. Sprawdzono szerokości 320, 390 i 1440 px oraz obsługę Enter/Tab i utrzymanie fokusu w modalu. Ekran pokazuje domyślnie zadania; konfiguracja ma osobny widok.

W Electronie sprawdzono automatyczne odczytanie prywatnego połączenia, brak automatycznego zapisu tokena w localStorage, HTTP z pochodzenia `file://`, działanie dozwolonego narzędzia oraz odrzucenie nawigacji i IPC z innego lokalnego pliku HTML. Testowy kontener wymagał flagi `--no-sandbox`; instalator użytkownika jej nie dodaje. Dlatego ten test nie dowodzi działania sandboxa Chromium na docelowym Linuksie.

Osobny test gotowego AppImage potwierdził start usługi bez ręcznych poleceń, automatyczny wybór istniejącego modelu, podłączenie go do pustego czatu i wykonanie próby odpowiedzi. Zadanie zakończyło się po wyjściu głównego procesu AppImage, również po usunięciu katalogu jego ekstrakcji. Ponowne uruchomienie zachowało PID serwera, token i wynik. Ollama była kontrolowaną symulacją HTTP; ten test nie mierzy jakości ani wydajności prawdziwego modelu.

Zbudowano także paczkę DEB. Nie instalowano jej na systemie użytkownika. Sumy finalnych plików:

```text
004f8e63b31261b69154ca6ded70caf488d0c1c8b64cd063c9e94b8adf3cc3fb  JARVIS.AppImage
81b31748191605fa1d53d5bc64eb87f1e387a3b8ab9ed1642f9c0d7d3670b2c6  JARVIS.deb
```

## Aktualność zależności

Publiczne metadane npm odczytane 2026-11-05, bez wysyłania manifestu projektu:

| Pakiet | W lockfile | Publiczne `latest` |
| --- | --- | --- |
| React | 18.3.1 | 19.3.1 |
| Vite | 5.4.21 | 8.3.5 |
| Electron | 33.4.11 | 45.2.3 |

Są to zmiany głównej wersji, wymagające migracji i weryfikacji kompatybilności. Nie wykonano ich w tej zmianie. Electron jest oznaczony jako zależność developerska, ale w gotowej paczce stanowi środowisko wykonawcze aplikacji.

`npm audit` nie został wykonany: automatyczny przegląd uprawnień odrzucił wysłanie listy zależności do registry.npmjs.org bez dodatkowej zgody. Nie znamy bieżącej liczby podatności critical/high. Zielone testy i build nie potwierdzają braku podatności.

## Niesprawdzone lub niewdrożone

- Rzeczywista lokalna inferencja, pomiar jakości i szybkości modelu, pełny test offline.
- Głos polski STT/TTS, mikrofon, fizyczny Windows/Android/iOS, parowanie urządzeń.
- Rzeczywisty systemd użytkownika, praca po wylogowaniu i restart całego komputera.
- Izolowane wykonywanie kodu i narzędzi na nowym serwerze: obsługuje on obecnie tylko analizy tekstowe.
- Pełna migracja starszej kolejki i pamięci klientów do jednego wspólnego stanu.
- Sales OS API na izolowanej instancji oraz testy natywne Android/iOS. Poprawiono oczekiwany identyfikator pakietu w szablonowym teście Androida, ale nie uruchomiono go.
- Porównanie inteligencji z konkurencją przy równych modelach, zadaniach i budżetach.

Nie ma podstaw do oceny 10/10 lub 13/10. Ocena subiektywna względem całej wizji OMEGA pozostaje 3/10; powyższe dowody dotyczą konkretnego, ograniczonego zakresu.
