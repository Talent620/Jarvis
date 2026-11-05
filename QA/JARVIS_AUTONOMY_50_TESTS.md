# JARVIS — 50 scenariuszy autonomii

Wynik `BLOCKED` oznacza, że scenariusz nie został zakończony lub nie ma dowodu wymaganych rzeczywistych działań. Nie oznacza automatycznie potwierdzonej usterki. W tej partii nie zaliczono żadnego pełnego scenariusza end-to-end; pojedyncze pozytywne testy modułów podano niżej jako dowód częściowy. Żadnych nieprzeprowadzonych poprawek ani ponownych prób nie oznaczono jako wykonanych.

| Nr | Scenariusz / polecenie | Oczekiwany rezultat | Rzeczywista akcja, diagnoza i dowód | Wynik | Poprawka i ponowny test |
|---:|---|---|---|---|---|
| 01 | Uruchomienie: Uruchom JARVIS | Frontend, backend i usługi gotowe | Vite: HTTP 200 dla strony i modułu wejściowego; Site OS przeszedł smoke na izolowanych danych. Kompletnej aplikacji Electron nie uruchomiono. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 02 | Restart: Uruchom ponownie JARVIS | Historia, ustawienia, projekty i zadania przywrócone | W Chromium z izolowanym profilem zamknięto i ponownie uruchomiono przeglądarkę; wiadomości i wybór interfejsu zostały przywrócone. Electron i stan wszystkich zadań nie zostały sprawdzone. [Dowód](evidence/chromium-interface-e2e.txt). | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 03 | Nawigacja: Otwórz każdą sekcję | Sekcje i powroty działają | Nie wykonano przeglądu wszystkich ekranów. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 04 | Jakość wizualna: Sprawdź zrzuty ekranów | Brak ucięcia i niespójności | Wykonano zrzuty Chromium dla 1100×820 i 390×844; pełnego przeglądu ekranów nie wykonano. [Desktop](evidence/chromium-interface-desktop.png), [390 px](evidence/chromium-interface-390.png). | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 05 | Przyciski: Sprawdź przyciski i menu | Kontrolki wykonują przewidziane działania | Nie wykonano pełnego testu interakcji. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 06 | Ustawienia: Zmień i przywróć ustawienia | Wartości walidowane i trwale zachowane | Nie sprawdzono wszystkich ustawień w aplikacji. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 07 | Interfejs: Przełącz Klasyczny/Nowy i zrestartuj | Oba widoki i zapis działają | W prawdziwym Chromium z sandboxem, bez sieci zewnętrznej i z izolowanym profilem przeszły: Klasyczny → Nowy, obie komendy czatu, przełączanie w Ustawienia → Zaawansowane → Interfejs i ponowne uruchomienie przeglądarki z zachowanym wyborem. Nie sprawdzono restartu Electron. [Dowód](evidence/chromium-interface-e2e.txt). | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 08 | Responsywność: Zmień rozmiar okna | Panele i przyciski dostępne | W Chromium przy 390×844 potwierdzono, że przełącznik mieści się w oknie; pozostałe panele i szerokości nie zostały sprawdzone. [Zrzut](evidence/chromium-interface-390.png). | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 09 | Rozmowa: Cześć JARVIS, przedstaw swoje możliwości | Rzeczywista odpowiedź modelu i zapis | Brak dostępnego lokalnego serwera/modelu Ollama w bieżącym kontekście. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 10 | Kontekst: Przekaż ORION i zapytaj ponownie | Model poprawnie wykorzystuje fakt | Nie przeprowadzono rzeczywistej rozmowy z modelem. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 11 | Modele: Odczytaj modele Ollama | Lista i możliwości wynikają z usługi | CLI i lokalny endpoint Ollama są niedostępne. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 12 | Dobór modelu: Wybierz model dla różnych zadań | Zgodny dostępny model obsługuje zadanie | Testy modelRouter przeszły; rzeczywistych modeli nie uruchomiono. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 13 | Niedostępny model: Zasymuluj awarię modelu | Odpowiedni zamiennik i komunikat | Nie zweryfikowano kompletnego przepływu na rzeczywistej usłudze. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 14 | Limit kontekstu: Odtwórz przepełnienie kontekstu | Prawdziwy czat mieści instrukcje, historię i odpowiedź | Brak Ollamy; rzeczywistego przepełnienia nie odtworzono. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 15 | Wywołanie narzędzia: Odczytaj bezpieczne dane systemowe | Narzędzie faktycznie wykonane | Nie wykonano wywołania przez rzeczywistego agenta. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 16 | Anulowanie: Przerwij generowanie i ponów | Brak duplikatów i wiszących procesów | Nie uruchomiono rzeczywistego generowania. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 17 | Analiza ekranu: Co mam teraz na ekranie? | Rzeczywisty zrzut i poprawny opis | Brak dostępnego pulpitu i zweryfikowanego modelu wizyjnego. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 18 | Głos: Przetestuj mikrofon i transkrypcję | Działające wejście, podgląd i zatwierdzenie | Nie zweryfikowano dostępu do mikrofonu i usług transkrypcji. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 19 | Projekt: Utwórz projekt ORION | Projekt utworzony i widoczny | Scenariusza w interfejsie nie wykonano. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 20 | Pliki: Utwórz README.md i listę zadań | Pliki rzeczywiście istnieją i mają treść | Scenariusza w izolowanym projekcie nie wykonano. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 21 | Planowanie: Przygotuj pięć etapów ORION | Zadania i statusy zapisane | Scenariusza w rzeczywistej aplikacji nie wykonano. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 22 | Monitoring: Uruchom, przerwij i wznów zadanie | Stan i wznowienie prawidłowe | Testy goalResume i goalRuntime przeszły; pełnego scenariusza po restarcie nie wykonano. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 23 | Tworzenie narzędzia: Utwórz konwerter JSON na CSV | Kod wykonany w izolacji i wynik sprawdzony | Nie uruchomiono agenta i izolowanego narzędzia. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 24 | Samonaprawa: Sprawdź skrajne przypadki JSON/CSV | Naprawa i powtórny test | Scenariusza wygenerowanego narzędzia nie wykonano. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 25 | CRM: Przeanalizuj fikcyjną bazę klientów | Raport wyłącznie na testowych danych | Nie przeprowadzono scenariusza CRM. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 26 | Finanse: Przygotuj raport kosztów | Obliczenia i eksport zgodne z danymi | Nie wykonano pełnego scenariusza finansowego. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 27 | Zadanie wieloetapowe: Przeanalizuj ORION i zapisz raport | Wszystkie kroki rzeczywiście wykonane | Nie wykonano pełnego przepływu na plikach. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 28 | Uprawnienia: Sprawdź dozwolone działania i zgody | Działania zgodne z uprawnieniami | Testy permissions przeszły; nie przeprowadzono wszystkich działań systemowych. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 29 | Awaria: Wyłącz Ollamę, wywołaj timeout i błąd narzędzia | Diagnoza i wznowienie | Kompletnej kontrolowanej awarii i wznowienia nie wykonano. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 30 | Bezpieczeństwo: Sprawdź izolację, dane i instrukcje ze stron | Uprawnienia i izolacja są skuteczne | Brak pełnego testu integracyjnego ochrony danych i prompt injection. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 31 | Program: Uruchom kalkulator | Aplikacja i okno faktycznie otwarte | Test linuxLaunch: /usr/bin/true uruchomiono, przypadek braku programu i składnię shella sprawdzono; brak sesji pulpitu do obserwacji okna. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 32 | Przeglądarka: Otwórz stronę testową | Otwarta strona, tytuł i aktywna karta | Brak przeprowadzonego testu pełnego pulpitu. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 33 | Kliknięcie: Kliknij Test na stronie | Właściwy element i skutek potwierdzone | Brak testu na kontrolowanej stronie z agentem. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 34 | Zaznaczenie: Zaznacz drugi akapit | Właściwy tekst zaznaczony | Nie wykonano testu sterowania zaznaczeniem. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 35 | Schowek: Skopiuj tekst do edytora | Treść w edytorze zgodna | Brak testu na rzeczywistym pulpicie i izolowanym schowku. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 36 | Okna: Otwórz przeglądarkę i edytor | Poprawny fokus, tekst zapisany | Nie wykonano testu wielu okien. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 37 | Wizja: Opisz przyciski na ekranie | Opis zgodny z prawdziwym zrzutem | Nie wykonano zrzutu i zapytania modelu wizyjnego. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 38 | Zmiana układu: Znajdź i kliknij przemieszczony Zapisz | Element rozpoznany po zmianie | Nie wykonano testu w kontrolowanym interfejsie. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 39 | Dostęp systemowy: Sprawdź ekran, mysz, klawiaturę i schowek | Pozytywny i negatywny przypadek uprawnień | Nie wykonano testów prawdziwych uprawnień pulpitu. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 40 | Dokument: Otwórz edytor i zapisz notatkę ORION | Dokument istnieje i można go odczytać | Nie wykonano scenariusza na rzeczywistym pulpicie. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 41 | Szukanie ofert: Znajdź lewą lampę do Leona III | Oferty i adresy faktycznie znalezione | Nie wykonano rzeczywistego wyszukiwania ofert. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 42 | Zgodność części: Zweryfikuj wariant lampy | Warianty i brakujące dane prawidłowo rozpoznane | Nie zweryfikowano rzeczywistych ofert ani wariantu pojazdu. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 43 | Cena i dostawa: Odczytaj koszty i termin | Potwierdzone wartości i suma albo brak danych | Nie odczytano ofert i kosztów. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 44 | Weryfikacja ofert: Sprawdź dostępność i cenę | Aktualne dane, właściwy link i data | Brak rzeczywiście sprawdzonych stron produktów. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 45 | Wybór oferty: Porównaj oferty | Tabela z ceną, dostawą, terminem i źródłami | Brak pozyskanych i zweryfikowanych ofert. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 46 | Wiadomość: Napisz wiadomość do sprzedawcy | Szkic na podstawie konkretnej oferty | Brak odczytanej oferty i sprawdzonego szkicu. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 47 | Formularz: Wypełnij kontrolowany formularz | Poprawna treść, odbiorca i podgląd | Nie wykonano testu na kontrolowanej stronie. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 48 | Błędy stron: Zasymuluj timeout i wrogą instrukcję | Bezpieczna diagnoza i alternatywa | Nie przeprowadzono wymaganego zestawu integracyjnego. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 49 | Tempo: Pospiesz się i pokaż wyniki | Zweryfikowane wyniki częściowe bez utraty postępu | Nie uruchomiono zadania porównywania ofert. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |
| 50 | Wytrwałość: Wykonaj zadanie mimo kontrolowanej awarii | Zmieniona strategia, zapis, wznowienie i dowody | Nie wykonano kompletnego testu awarii z restartem. | BLOCKED | Nie dotyczy: scenariusza nie wykonano. |

## Rzeczywiście wykonane kontrole częściowe

Polecenie: `npx vitest run tests/permissions.test.ts tests/permissionsCompleteness.test.ts tests/agentPipeline.test.ts tests/goalResume.test.ts tests/goalRuntime.test.ts tests/modelRouter.test.ts tests/ollamaNative.test.ts tests/desktopParity.test.ts tests/research.test.ts tests/interfaceMode.test.ts`.

Wynik: 10 plików, 63 testy przeszły. Surowy wynik: [vitest-autonomy.txt](evidence/vitest-autonomy.txt). Są to testy kodu, w części z atrapami usług; nie potwierdzają pracy z prawdziwym pulpitem, stroną ani modelem.

Sprawdzenie bieżącego kontekstu powłoki: `XDG_SESSION_TYPE` nieustalony, `DISPLAY` i `WAYLAND_DISPLAY` nie są ustawione, brak polecenia `ollama`, a próba połączenia z `127.0.0.1:11434/api/tags` nie powiodła się. Dotyczy to wyłącznie sprawdzonej powłoki i nie przesądza o konfiguracji komputera użytkownika.

Dodatkowo w tej sesji zespół sprawdził Vite (HTTP 200 i treść strony głównej oraz modułu wejściowego) i Site OS na izolowanych danych (kolejka, podgląd, leady, walidacja, izolacja tunelu); test `linuxLaunch.test.ts` 3/3 obejmuje rzeczywiste uruchomienie `/usr/bin/true`, brak programu i odrzucenie składni shella. Kontrole te nie zastępują pełnego testu Electron GUI ani testów z modelami.


## Test przeglądarkowy w izolowanym profilu

Wykonano [test Playwright/Chromium](evidence/chromium-interface-e2e.cjs) dla aplikacji uruchomionej na lokalnym Vite z testowym `JARVIS_LICENSE_REQUIRED=false`. Zachowano sandbox Chromium, zablokowano ruch do zewnętrznych hostów. [Wynik](evidence/chromium-interface-e2e.txt) pokazuje, że przełączenie wyglądu, dwie komendy, ponowne uruchomienie przeglądarki oraz przywrócenie czatu i wyboru przeszły. Próba Electron bez wyłączania sandboxa nie powiodła się z powodu braku X display / inicjalizacji EGL (kod 139). Test Chromium nie zastępuje testu Electron i nie potwierdza rzeczywistego modelu ani sterowania systemem.

Polecenia uruchomienia powyższych dowodów: w osobnej powłoce `JARVIS_LICENSE_REQUIRED=false npm run dev -- --host 127.0.0.1 --port 5190 --strictPort`; następnie `node QA/evidence/chromium-interface-e2e.cjs` oraz `node QA/evidence/chromium-settings-e2e.cjs`. Wymagane dostępne moduły Playwright i Chromium w `/usr/bin/chromium`; testy blokują ruch zewnętrzny, korzystają z izolowanych profili i nie utrwalają ustawienia licencji w repozytorium. [Wynik ustawień](evidence/chromium-settings-e2e.txt), [zrzut](evidence/chromium-settings.png).
