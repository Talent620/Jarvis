# Umiejętności i integracje JARVIS

Funkcje opisane poniżej wymagają aplikacji desktopowej z wersji 2.1.0-alpha.2. Ich stan i dowody odbioru są w `QA/autonomia60/durable/requirements.json`. Test kontrolowanego dostawcy nie potwierdza samodzielnego działania modelu użytkownika.

## Umiejętności

W istniejących Ustawieniach otwórz **Umiejętności JARVIS**. Wyszukaj potrzebną możliwość, sprawdź źródło, instrukcje, licencję i zasoby, następnie dodaj wybraną wersję do kwarantanny. **Testuj** sprawdza integralność i wymagania; dla obsługiwanego kodu uruchamia zadeklarowany test w izolacji. **Ustaw zakres dla tego źródła** otwiera konfigurację polityki, którą potwierdza właściciel w oknie systemowym. Dopiero sprawdzoną wersję można aktywować.

Zwykła rozmowa korzysta z tego samego menedżera przez narzędzia `skill_search`, `skill_manage` i `skill_run`. Model może szukać, sprawdzać i używać umiejętności w zatwierdzonym zakresie. Nie może sam zatwierdzić nowej polityki. Wynik instrukcyjny jest procedurą do wykonania; JARVIS musi nadal wykonać pierwotne zadanie i sprawdzić rezultat.

Publiczne katalogi są odczytywane przez Git. Treść zapytania służy do lokalnego rankingu pobranych opisów. Wersja pakietu jest związana z commitem i SHA-256 zawartości. Sprawdzenie aktualizacji tworzy osobnego kandydata; nie podmienia wersji przypiętej do trwającego zadania. **Cofnij zgodę wersji** lub wyłączenie polityki źródła blokuje dalsze użycie. Rollback wymaga wcześniejszej, sprawdzonej i nieodwołanej wersji.

Licencja całego repozytorium nie zawsze obejmuje każdy pakiet. W szczególności część umiejętności dokumentowych Anthropic jest dostępna na odrębnych warunkach. Stary katalog `openai/skills` wskazuje następcę `openai/plugins`; JARVIS odczytuje pliki umiejętności, nie uruchamia instalatorów, hooków ani manifestów całego pluginu. Nieznane warunki wymagają przeglądu właściciela.

### Zakres wykonania kodu

Obecny backend obsługuje skrypty Node.js na Linux x86_64. Wymaga istniejących `bwrap`, `prlimit` i Node.js oraz działającej próby izolacji. Nie instaluje tych zależności. Inne platformy lub brak działającej izolacji dają konkretną blokadę wykonania.

Skrypt otrzymuje przypiętą kopię zasobów tylko do odczytu, wejście JSON na stdin i ograniczony katalog tymczasowy. Nie otrzymuje katalogu domowego, sekretów środowiska, sieci ani zapisu na hoście. Obowiązują limity czasu, pamięci adresowej, plików i wyjścia; tworzenie procesów potomnych jest zablokowane. Wynik wraca przez stdout. Ewentualny zapis wyniku do dokumentu jest osobną operacją JARVIS-a z własnymi uprawnieniami.

Test zadeklarowany przez autora pakietu sprawdza jego kontrakt. Sam w sobie nie dowodzi poprawności dowolnego zadania ani bezpieczeństwa wszystkich instrukcji. `STATIC_ONLY` oznacza kontrolę metadanych i zasobów, a nie wykonanie zadania. Kod Python, dowolne polecenia powłoki i instalowanie zależności przez skrypt nie są wspierane przez ten backend.

## Przeglądarka

W Ustawieniach → **Przeglądarka JARVIS** zatwierdź konkretny serwis: protokół, host i port. Oddzielnie wybiera się interakcje, pobrania i dostęp do usług lokalnych. Aplikacja używa istniejącego Chromium i odrębnego profilu; nie kopiuje prywatnych cookies użytkownika. Nietypową ścieżkę przeglądarki można podać przy uruchamianiu przez `JARVIS_BROWSER_EXECUTABLE`.

Adapter Playwright obsługuje odczyt widocznego tekstu i elementów, wypełnianie pól, kliknięcia i ograniczone pobrania. Wysyłka wymaga zgody na konkretną operację. Akcja kliknięcia nie jest automatycznie dowodem skutku na serwerze. CAPTCHA i odmowa dostępu pozostają przeszkodą; nie są obchodzone. Cofnięcie dostępu i STOP zamykają wyłącznie przeglądarkę uruchomioną przez JARVIS-a.

Obsługiwany zakres obejmuje główną ramkę strony. Jedno kliknięcie może skierować do zatwierdzenia jedną rzeczywistą nawigację; zgoda pokazuje jej adres, metodę i treść. Starsze żądania szkicu, autosave oraz zasoby działające w tle nie dziedziczą tej zgody. Przekierowania HTTP są zatrzymywane przed podążeniem za nowym adresem. Osadzone ramki oraz formularze wysyłane w tle przez JavaScript (fetch/XHR, często aplikacje SPA) nie mają w tym adapterze obsługiwanej ścieżki wysyłki. Wymagają osobnego adaptera właściwej usługi; kliknięcie nie może zostać przedstawione jako ich udana wysyłka.

## Monitoring i powiadomienia

W istniejącym panelu **Cele → Monitoring i powiadomienia** skonfiguruj adres własnej usługi changedetection.io lub ntfy. Dane logowania są zapisywane przez systemowy magazyn Electron `safeStorage`; brak bezpiecznego magazynu blokuje konfigurację zamiast zapisywać token jawnym tekstem. Usługi lokalne wymagają odrębnej zgody. JARVIS nie instaluje serwerów ani usług systemowych.

Źródło changedetection.io wymaga istniejącej obserwacji i jej UUID. Pierwszy poprawny snapshot jest punktem odniesienia; późniejsza zmiana jest zdarzeniem. Czas sprawdzenia przez usługę pozostaje odrębny od czasu odczytu przez JARVIS-a. Jest to monitoring konkretnej obserwacji, nie automatyczny dostęp do całego rynku Allegro.

Kanał ntfy wymaga świadomego wyboru serwera i tematu oraz potwierdzenia zakresu ujawnianych danych. Token sam w sobie nie dowodzi prywatności tematu. Odpowiedź dostawcy oznacza **ACCEPTED**, nie potwierdzone przeczytanie wiadomości. Timeout po wysyłce pozostawia niepewny skutek; JARVIS nie powiela jej bez sprawdzenia. W testach projektu nie wysyłamy alertów do prawdziwych osób ani publicznych tematów.

Harmonogram monitora może używać interwału albo reguły dziennej, tygodniowej lub miesięcznej w Europe/Warsaw. Nieistniejąca godzina przy zmianie czasu i nieistniejący dzień miesiąca są pomijane; podwójna godzina jesienna nie uruchamia zadania dwa razy. Po przerwie wykonuje się ograniczone sprawdzenie aktualnego stanu, bez wymyślania wyników z czasu wyłączenia. Tryb działania po zamknięciu okna wymaga jawnego włączenia. Wyłączony komputer nie prowadzi obserwacji.

## Pozostałe integracje

Klient MCP pozostaje istniejącym klientem JARVIS-a. Podłączenie serwera nie daje mu automatycznie zgody na wszystkie narzędzia. Rozłączenie, odwołanie i STOP unieważniają oczekujące wywołania; rozpoczęty skutek w obcej usłudze może wymagać sprawdzenia.

Nie uruchamiamy równolegle autonomicznych hostów Hermes, OpenClaw, n8n ani OpenHands. Decyzje dotyczące źródeł, licencji i zastępujących je funkcji znajdują się w polu `integration_decisions` wspólnego rejestru QA. Sam wpis w tym rejestrze nie oznacza zainstalowanej integracji ani zaliczonego testu na urządzeniu użytkownika.
