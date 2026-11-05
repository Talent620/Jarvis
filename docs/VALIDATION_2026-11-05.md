# Walidacja Linux i lokalnego serwera — 2026-11-05

Badana gałąź: `codex/linux-pro-new-20261105`. Środowisko testowe: Debian 13, Node 24.22.1, npm 11.9, Chromium oraz Electron 33.4.11. To nie jest test na fizycznym komputerze użytkownika.

## Wyniki

| Zakres | Wynik | Granica dowodu |
| --- | --- | --- |
| `npm test` | **3042 PASS, 350 plików, 0 FAIL/SKIP** | Przypadki testowe, nie miara inteligencji |
| `npm run lint` | PASS, bez ostrzeżeń | Obejmuje teraz także `server/runtime` |
| `JARVIS_LICENSE_REQUIRED=false npm run build` | PASS | Vite nadal zgłasza ostrzeżenie o dużych chunkach |
| Runtime HTTP | 35 PASS, zawarte w wyniku Vitest | Prawdziwy serwer i zapis na dysku; model symulowany |
| Kompas E2E | 18 PASS | Osobny podprojekt, test w Chromium |
| Site OS API smoke | PASS | Nie obejmuje pełnego wizualnego smoke Electron |
| Workspace tools | 10 PASS, 2 NOT_RUN | SQLite i PostgreSQL nie zostały sprawdzone |
| Instalator runtime | 20 sprawdzeń PASS | Rzeczywiste CLI; menedżer systemd symulowany |
| Launcher instalowanej aplikacji | 19 sprawdzeń PASS | Start, ponowne użycie procesu, limit czasu i ikona |
| Panel runtime w Chromium | PASS | Rzeczywisty backend HTTP, symulowana Ollama |
| Electron i IPC runtime | PASS | Rzeczywisty proces Electron i prywatny plik połączenia |
| AppImage: jedno uruchomienie | **PASS** | Wersjonowany `npm run test:linux-runtime`; model symulowany |

Po krytycznym audycie przeszło 3013 przypadków w 349 plikach. Po dalszych poprawkach odzyskiwania, archiwum i blokad: **3042/3042 w 350 plikach**, czyli 29 dodatkowych przypadków. Nie sumujemy kolejnych uruchomień ani zagnieżdżonych grup testów.

Nie znaleziono dowodu istnienia 10000 testów. Liczba bloków `describe` raportowana przez Vitest nie jest liczbą dodatkowych przypadków i nie została dodana do wyniku. Historyczne wyniki dotyczą wcześniejszych wersji kodu.

Testy runtime obejmują idempotencję, anulowanie, timeout, wygaśnięcie gotowości, odmowę modelu chmurowego, restart i `SIGKILL` osobnego procesu, brak nowej inferencji po zatrzymaniu, odrzucenie zewnętrznego adresu odzyskiwanego ze stanu, archiwizację z zachowaniem idempotencji i wykonanie 501. zadania. Archiwum zachowuje starsze wyniki; panel udostępnia teraz ich stronicowany podgląd.

Dodatkowe testy startu obejmują wybór już zainstalowanego modelu, automatyczny test odpowiedzi, pierwszeństwo kolejki, blokadę profilu i odzyskanie jej po awarii oraz ochronę wyboru użytkownika przed równoległym CLI/API. Testy konfiguracji czatu sprawdzają zachowanie istniejących kluczy i dostawców, zmian podczas oczekiwania, ręcznie wybranego modelu oraz ograniczenie czasu także dla zawieszonego IPC.

Test przeglądarkowy sprawdził wybór modelu, próbę odpowiedzi, zakończenie zadania po zamknięciu klienta, anulowanie, wyniki po restarcie i usunięcie zielonego statusu przy utracie połączenia. Sprawdzono szerokości 320, 390 i 1440 px oraz obsługę Enter/Tab i utrzymanie fokusu w modalu. Ekran pokazuje domyślnie zadania; konfiguracja ma osobny widok.

W Electronie sprawdzono automatyczne odczytanie prywatnego połączenia, brak automatycznego zapisu tokena w localStorage, HTTP z pochodzenia `file://`, działanie dozwolonego narzędzia oraz odrzucenie nawigacji i IPC z innego lokalnego pliku HTML. Testowy kontener wymagał flagi `--no-sandbox`; instalator użytkownika jej nie dodaje. Dlatego ten test nie dowodzi działania sandboxa Chromium na docelowym Linuksie.

Końcowy wersjonowany test `npm run test:linux-runtime` na nowym AppImage potwierdził start usługi bez ręcznych poleceń, automatyczny wybór istniejącego modelu, podłączenie go do pustego czatu i wykonanie próby odpowiedzi. Zadanie zakończyło się po wyjściu głównego procesu AppImage. Ponowne uruchomienie zachowało PID serwera, token i wynik. Skrypt potwierdził sprzątnięcie własnych procesów i katalogów. Log: `/workspace/.jarvis-cloud/recovery-final-appimage.log`. Wykonanie tego testu w CI pozostaje NOT_RUN. Ollama była kontrolowaną symulacją HTTP; ten test nie mierzy jakości ani wydajności prawdziwego modelu.

## Weryfikacja poprawek audytu

Wynik 3013 obejmuje nowe regresje anulowania żądania i przegranej próby dostawcy, braku ponowienia narzędzia po efekcie, prywatnego czatu, wyścigów pauzy/anulowania celu, rzeczywistych błędów mutatorów, synchronizacji usuniętych faktów, uszkodzonej pamięci, mikrofonu i kolejki zgód. Testy nie wykonują prawdziwych wysyłek ani płatności.

- **STOP i zgody:** sprawdzono spóźnione narzędzie, timeout/fallback, anulowanie dialogu oraz FIFO dla czatu i celu. Osiem regresji kolejki zgód obejmuje rzeczywisty komponent PermissionDialog i jego reset między prośbami. STOP nie wycofuje już rozpoczętej operacji.
- **Prywatność i dane:** prywatna rozmowa pomija automatyczne zapisy pamięci, epizodów, grafu i Mem0. Usunięcia faktów mają identyfikatory zachowane podczas synchronizacji i importu. Chromium potwierdził brak powrotu usuniętej aktywnej rozmowy po kolejnym poleceniu; testy obejmują odmowę magazynu.
- **Głos:** jednostkowe scenariusze start–stop–start, opóźnionej zgody mikrofonu, błędu AudioContext i pętli błędów. Chromium z symulowanym mikrofonem potwierdził brak startu po Stop i prawidłowy stan po zakończeniu rozpoznawania. Fizyczny mikrofon i jakość STT/TTS pozostają NOT_RUN.
- **Interfejs:** testy i Chromium potwierdziły nawigację do kolejki, obsługę klawiatury i natychmiastowe pojawienie się/ukończenie zadania w Mojej liście. Obejrzano kolejkę i listę w Classic/PRO przy 320 px; nie stwierdzono poziomego przepełnienia ani błędów JS. Historię sprawdzono przy 320/390/1440 px, izolowany panel pamięci przy 320/1280 px. Nie sprawdzono każdej zakładki ani nie przeprowadzono badań z użytkownikami.
- **Połączenia:** test Mem0 rozróżnia poprawną pustą odpowiedź od HTTP 503, awarii sieci i błędnego formatu. Nie potwierdza wszystkich operacji rzeczywistej usługi.
- **Sekrety:** skan zakończył się komunikatem `Skan sekretów: czysto`. Nie zastępuje zewnętrznego audytu bezpieczeństwa.

Końcowe wyniki środowiskowe: `/workspace/.jarvis-cloud/recovery-final-vitest.json`, `recovery-final-lint.log`, `recovery-final-build.log`. Mapa znalezisk, decyzji i ograniczeń: [AUDIT_COVERAGE_2026-11-05.md](AUDIT_COVERAGE_2026-11-05.md).

## Kontynuacja: odzyskiwanie, archiwum i aktualizacja 0.2.0

- **Zgłoszenia:** osobny trwały zapis każdej intencji przed POST, przypisanie do adresu i `serverId`, brak tokenu w kopii, ponowienie tym samym kluczem wyłącznie po kliknięciu. Spóźnione ACK z innej karty usuwa tylko własny rekord. Wykrycie dawnego wspólnego formatu wstrzymuje wysyłkę bez automatycznej migracji/usuwania. Helper i klient: 33/33 PASS, zawarte w głównym zestawie. Dodatkowy Chromium sprawdził faktyczne kliknięcie „Ponów” po utracie POST przed backendem oraz ACK po przyjęciu: ten sam klucz, jedno zadanie, jedno wykonanie modelu, usunięcie kopii po potwierdzeniu; 0 błędów strony.
- **Archiwum:** uwierzytelniona paginacja i odczyt wyniku na żądanie, lookup identyfikatora zgłoszenia, kontrola oczekiwanego serwera przy zapisie, ochrona przed symlinkami i wadliwymi rekordami. Wszystkie testy backendu: 35/35 PASS, zawarte w głównym zestawie. Odczyt archiwum nadal kosztuje O(n) operacji na plikach; parsowanie zawartości nie trzyma blokady mutacji kolejki.
- **Blokada profilu:** równoległy zapis nie widzi już częściowego JSON. Deterministyczna próba z zatrzymanym writerem odtworzyła `CORRUPT_STATE` starej wersji; publikacja gotowego pliku przez atomowy link pozwala obu zapisom poprawnie nadać kolejne wersje. Nie zmniejszono zakresu testu ani nie zamaskowano błędu ponawianiem.
- **Chromium:** rzeczywista lokalna strona HTTP i runtime, symulowana Ollama. Utrata odpowiedzi po przyjęciu POST → przeładowanie → ten sam wynik i jedno wykonanie modelu; odzysk działa również po archiwizacji. Potwierdzono strony 20+2, wynik pobierany na żądanie, zachowanie nowej intencji przy późnym ACK drugiej karty, odmowę zapisu przed POST, starszy serwer bez nowych możliwości i brak przenoszenia tokenu do innego adresu. Zrzuty 320/1440 obejrzane, brak poziomego przepełnienia i błędów strony. Jest to test izolowanego rzeczywistego komponentu, nie fizycznego sprzętu.
- **Czytelność:** poprawiono globalne tło hover przycisku głównego w Classic. Chromium i obejrzane zrzuty potwierdziły cztery stany: Classic/PRO × 320/1440 px, przycisk aktywny i widoczny, 0 błędów strony. Kontrast obliczony przed filtrem jasności: Classic 6,90:1, PRO 11,90:1. Log: `/workspace/.jarvis-cloud/runtime-primary-hover-browser.log`.
- **Instalator:** 10/10 odrębnych scenariuszy rzeczywistego przejścia runtime 0.1.0 (`857def1`) → 0.2.0, zachowania tokenu/profilu/zadań, `--no-start`, rollbacku i odmowy zatrzymania obcej instancji. `systemctl` był atrapą, model nie był używany. Test: `npm run test:runtime-upgrade`; źródła starej wersji są wymagane, brak źródeł kończy się jawnym błędem. Zasady i ograniczenia: [RUNTIME_UPGRADE.md](RUNTIME_UPGRADE.md).
- **CI:** przygotowano zależności `runtime-smoke → build → publish`. Osobisty testowy AppImage nie zastępuje paczki licencjonowanej. YAML, komendy Bash i kontrakt zależności sprawdzono lokalnie. Przebieg na GitHub Actions oraz sandbox tamtego runnera: **NOT_RUN**. W lokalnym kontenerze finalny AppImage smoke przeszedł z jawnym testowym `--no-sandbox`.

Logi przeglądarki: `/workspace/.jarvis-cloud/runtime-recovery-browser.log`, `runtime-retry-browser.log`; paczki: `recovery-final-package.log`; AppImage: `recovery-final-appimage.log`. Żaden z tych wyników nie potwierdza jakości prawdziwego modelu.

## Paczki Linux

Zbudowano także paczkę DEB. Nie instalowano jej na systemie użytkownika. Sumy finalnych plików:

```text
e8a331c67067c4f3bb37da2c5042165d441c55164112d4ac12e9f22d221e18be  JARVIS.AppImage
434c2ab71da29d0050187ae4d8cf61f0df8d7626915d2974fbf75146ab42e2e3  JARVIS.deb
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
