# Lokalny serwer analiz JARVIS-a

Ten etap dodaje usługę `server/runtime`, panel **Analizy w tle** i trwałą kolejkę analiz tekstowych. Zadanie przyjęte przez serwer może pracować po zamknięciu okna JARVIS-a, gdy usługa nadal działa. Model generuje tekst; serwer nie wykonuje poleceń terminala, nie edytuje plików i nie uruchamia narzędzi modelu.

## Uruchamianie jednym kliknięciem

Na Linuksie otwórz skrót **JARVIS** albo AppImage. Aplikacja sprawdza działający serwer, uruchamia usługę użytkownika lub odłączony proces w tle i odczytuje prywatne połączenie. Nie trzeba ręcznie wpisywać adresu ani tokena. Kolejne otwarcie wykorzystuje działający proces i zachowane zadania.

Gdy profil nie ma wybranego modelu, serwer sprawdza modele już zainstalowane w lokalnej Ollamie, odrzuca rozpoznane modele chmurowe i embeddingowe, wybiera odpowiedni model tekstowy oraz wykonuje próbę odpowiedzi. Wcześniejszy wybór użytkownika pozostaje zachowany. W pustej konfiguracji czatu wybrany model zostaje podłączony automatycznie; istniejące klucze i ustawienia dostawców nie są zastępowane.

Jeżeli brakuje Ollamy lub modelu, aplikacja pokazuje panel przygotowania. **Uruchom i połącz** ponawia start serwera. Samo kliknięcie nie instaluje Ollamy ani nie pobiera wielogigabajtowych modeli. Pełny start lokalnej analizy jednym kliknięciem wymaga wcześniejszego przygotowania tych zasobów. Uprawnienia mikrofonu i kamery nadal wynikają z osobnych ustawień systemu.

Automatyczne uruchamianie desktopowe dotyczy Linuksa. Brak działającego systemd nie blokuje okna: działa odłączony proces, a jego log znajduje się w `~/.local/state/jarvis/runtime.log` lub pod `XDG_STATE_HOME`. Zamknięcie aplikacji go nie zatrzymuje; zatrzymanie opisano niżej.

## Czego potrzeba

Potrzebny jest Linux, działająca Ollama na tym samym komputerze i wcześniej zainstalowany model GGUF. Osobne CLI i usługa systemd wymagają Node.js; AppImage może użyć Node wbudowanego w Electron. Instalator JARVIS-a nie instaluje Ollamy ani nie pobiera modelu. Dobierz model do swojego sprzętu i sprawdź jego licencję. Dane o modelach udostępnia polecenie:

```bash
ollama list
```

Po pobraniu źródeł instalacja runtime w katalogu użytkownika wygląda tak:

```bash
bash scripts/install-runtime.sh
```

Gdy dostępna jest sesja `systemd --user`, instalator tworzy i uruchamia usługę `jarvis-runtime.service`. Gdy jej nie ma, wyświetla polecenie ręcznego startu w osobnym terminalu. Działanie usługi po wylogowaniu zależy od konfiguracji systemu; instalator nie włącza `linger`.

Instalacja ze źródeł JARVIS-a wywołuje również ten skrypt. Przełącznik `--no-start` instaluje usługę bez uruchamiania; `--no-launch` w instalatorze ze źródeł nie uruchamia ani aplikacji, ani usługi.

## Wybór modelu i zlecanie zadania

1. Przygotuj Ollamę z lokalnie zainstalowanym modelem, a następnie otwórz JARVIS-a.
2. W aplikacji otwórz **Analizy w tle**. Na desktopie połączenie jest odczytywane automatycznie z prywatnego pliku usługi.
3. W widoku **Konfiguracja** możesz zmienić automatycznie wybrany model. **Test lokalnego modelu** ponawia próbę odpowiedzi. Stan „Model odpowiada” wynika z odpowiedzi na rzeczywiste żądanie, a wynik po czasie wygasa.
4. Wpisz treść do analizy, kliknij **Dodaj do kolejki serwera** i sprawdź status lub wynik w tym samym panelu. Możesz anulować oczekujące lub trwające zadanie.

Lista obejmuje modele zgłoszone przez Ollamę jako GGUF, po odfiltrowaniu rozpoznanych metadanych zdalnego wykonania. To nie dowód faktycznej lokalności przetwarzania: loopback i metadane nie blokują ruchu wychodzącego Ollamy. Nie wykonano testu usług AI przy odciętym dostępie do sieci.

## Polecenia i diagnoza

```bash
~/.local/bin/jarvis-runtime status
~/.local/bin/jarvis-runtime test
systemctl --user status jarvis-runtime.service
journalctl --user -u jarvis-runtime.service --no-pager -n 100
```

Aby skonfigurować model z terminala, wstaw rzeczywistą nazwę z `ollama list`, po czym uruchom usługę ponownie i wykonaj test:

```bash
~/.local/bin/jarvis-runtime configure --model NAZWA_MODELU
systemctl --user restart jarvis-runtime.service
~/.local/bin/jarvis-runtime test
```

Polecenie `configure` zapisuje profil żądany; restart aktywuje go w uruchomionej usłudze. Zmiana modelu w panelu sprawdza metadane przed aktywacją i wymaga osobnego testu odpowiedzi. Brak modelu, brak połączenia, błąd lub wygasły pomiar nie są przedstawiane jako aktualna gotowość.

Zatrzymanie usługi systemd:

```bash
systemctl --user stop jarvis-runtime.service
```

Przy ręcznym uruchomieniu w terminalu zakończ proces kombinacją Ctrl+C. `~/.local/bin/jarvis-runtime stop` wysyła żądanie zatrzymania do uruchomionego serwera; do zarządzania usługą systemd używaj powyższego polecenia `systemctl`.

## Dane i kopia

Domyślny katalog danych to `~/.local/share/jarvis/runtime/`, a przy ustawionym `XDG_DATA_HOME` — `$XDG_DATA_HOME/jarvis/runtime/`. Zawiera profil, stan i wyniki kolejki oraz plik połączenia z tokenem. Token daje dostęp do zadań, dlatego przechowuj i udostępniaj kopie wyłącznie osobom uprawnionym.

`state.json` zawiera bieżące zadania. Przy osiągnięciu 500 rekordów serwer najpierw zapisuje zakończone, nieudane i anulowane analizy w katalogu `archive/`, a dopiero po trwałym zapisie usuwa je z bieżącej listy. Możesz wykonać tę operację wcześniej poleceniem `~/.local/bin/jarvis-runtime archive`. Archiwum zawiera osobne pliki JSON z pełną treścią zadań i wyników; nazwy są skrótami identyfikatorów żądania. Pliki mają uprawnienia `0600`. Archiwalne wpisy nie są obecnie wyświetlane w panelu; możesz je odczytać lokalnie w edytorze. `status` podaje ich liczbę.

Ponowne zgłoszenie tego samego identyfikatora i polecenia zwraca poprzedni wynik również po archiwizacji lub restarcie. Inne polecenie z tym samym identyfikatorem jest odrzucane. Nie usuwaj archiwum, jeśli chcesz zachować tę gwarancję. Historia nie ma automatycznego terminu usuwania, więc z czasem zajmuje więcej miejsca na dysku. Brak miejsca lub uszkodzenie danych jest zgłaszane jako błąd; serwer nie zastępuje wtedy stanu pustą kolejką.

Po przerwaniu procesu czysta analiza tekstowa może zostać wznowiona — obliczenie modelu może wykonać się ponownie. Wynik jest zatwierdzany dopiero po zapisie. Serwer nie gwarantuje pojedynczego wykonania obliczenia podczas awarii; nie obsługuje zadań powodujących zewnętrzne skutki. Rekordy rozpoczęte i przerwane przez awarię mogą być odzyskiwane do trzech prób. Przy problemie z blokadą `runtime.lock` najpierw sprawdź, czy stary proces nadal działa. Katalog `runtime.recovery` pozostawiony po awarii podczas odzyskiwania blokady wymaga sprawdzenia procesów przed jego ręcznym usunięciem.

Przed wykonaniem kopii zatrzymaj usługę, a następnie skopiuj cały katalog danych wraz z uprawnieniami. Dla domyślnej lokalizacji przykładowo:

```bash
cp -a ~/.local/share/jarvis/runtime ~/jarvis-runtime-backup
```

Po kopii możesz ponownie uruchomić usługę przez `systemctl --user start jarvis-runtime.service`. Backup i odtworzenie nie zostały jeszcze zweryfikowane na komputerze użytkownika; nie należy traktować samego skopiowania plików jako zaliczonego testu restore.

## Zakres i ograniczenia

- Serwer nasłuchuje wyłącznie na lokalnym loopback. Nie jest gotowym systemem parowania telefonu, Windowsa ani zdalnego dostępu. Nie wystawiaj surowej usługi do internetu.
- Model jest wybierany z zainstalowanych w Ollamie; brak modelu oznacza potrzebę jego przygotowania, nie automatyczne pobranie.
- Nowa kolejka obsługuje analizę tekstową. Starsza kolejka zadań narzędziowych nadal zależy od procesu klienta; zadania kodujące, głos, narzędzia i dostawcy chmurowi nie zostały przeniesione do runtime.
- Profil i test odpowiedzi dotyczą serwerowej analizy, a nie całego JARVIS-a. Globalne `LOCAL_AUTOPILOT`, egzekwowany brak ruchu do chmury, wspólna pamięć między urządzeniami oraz izolacja wykonywania kodu nie zostały wdrożone.
- Rzeczywisty model Ollama, polski głos i fizyczne urządzenia Windows/Android nie zostały przetestowane w tym środowisku. Testy z mockiem lub symulacją należy opisywać osobno.
- Jedna analiza działa w danej chwili. Kolejka mieści do 500 aktywnych zadań, polecenie do 24 000 znaków, odpowiedź do 200 000 znaków. Wywołanie modelu ma limit 120 sekund, test gotowości 30 sekund, a pomiar gotowości wygasa po 60 sekundach. To ograniczenia zasobów i czasu, nie deklaracja gwarantowanej wydajności sprzętu.
- API wymaga tokenu Bearer, serwer słucha na `127.0.0.1:3211`. Zapytania desktopowe z origin `null` są dopuszczone tylko z tokenem; dodatkowe pochodzenia przeglądarki wymagają jawnego `JARVIS_RUNTIME_ALLOWED_ORIGINS`. Testy HTTP korzystają z osobnego, sztucznego serwera Ollamy na loopback; sprawdzają protokół, trwałość, awarie procesu i idempotencję, nie jakość rzeczywistego modelu.
