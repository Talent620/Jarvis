## Kontynuacja alpha.5 — częściowa implementacja

Dodano wyszukiwanie w oficjalnym rejestrze MCP po natywnej zgodzie na dokładne zapytanie oraz tworzenie na skonfigurowanym changedetection watcha w pauzie i z wyciszonymi powiadomieniami. Dane kandydata są niezaufane; wyszukiwanie nie instaluje ani nie uruchamia serwera. Po zapisie zamiaru ponowienie przy nieznanym wyniku nie wysyła drugiego POST; niezależny GET sprawdza parametry i stan. Testowano na kontrolowanym HTTP i prawdziwym magazynie, nie na rzeczywistym changedetection ani z prawdziwą Ollamą. Dostęp do rejestru MCP jest w tym środowisku zablokowany przez politykę sieci. Włączenie watcha, powiązanie jego STOP/wznowienia i powiadomień z trwałym zadaniem oraz pełny cykl zdobycia MCP pozostają nieukończone.

# Dostarczenie alpha.4 — 2026-11-06

Publiczne wydanie eksperymentalne: https://github.com/Talent620/Jarvis/releases/tag/v2.1.0-alpha.4 . Tag wskazuje `d2bc13b0a63d52e22be7307ecb39809fedf8b258`; wcześniejszej pracy ani tagów nie przepisano. Pobrano 9 plików i zweryfikowano ich sumy, 17 modułów Electron, 5 dokumentów, metadane oraz publiczny klucz wystawcy. `delivery-alpha4.json` i `evidence/alpha4-published/SHA256SUMS` zawierają wyniki i adresy. Testy lokalne: 3101/3101 PASS; lint i build PASS. CI Tests, Ubuntu gałęzi i Ubuntu taga PASS.

Rzeczywisty `.deb` zawiera pomocnika chrome-sandbox zgodnego z rejestrem pakietu oraz skrypt weryfikujący chronione katalogi i plik przed ustawieniem root:root 4755. Nie uruchamiano aplikacji jako root i nie wyłączano sandboxa. Obie próby uruchomienia pobranych pakietów na izolowanych profilach są BLOCKED z powodu braku X/DISPLAY. Nie wykonano instalacji, migracji ani rollbacku na komputerze użytkownika.

`qa:desktop` na dokładnym commicie zakończył się kodem 2: komenda lokalna, ustawienia, restart i testowa aktywacja licencji PASS; A/B BLOCKED z powodu braku Ollamy na 11434/11435; C BLOCKED z powodu braku pulpitu. `evidence/alpha4-desktop/REPORT.md`. Kontrolowany przebieg skilla ma wcześniej zeskanowany lokalny katalog i syntetycznego dostawcę: nie dowodzi samodzielnego rozpoznania brakującej zdolności ani wykonania przez realny model. Usługi monitorowania i ntfy zweryfikowano na kontrolowanych serwerach, nie na rzeczywistych kontach.

**Stan alpha.4:** pełny zakres nadal nie był ukończony. Wyszukiwanie nowych serwerów MCP i tworzenie nowego watcha z polecenia były brakującą implementacją; skonfigurowany klient MCP i adapter istniejącego watcha ich nie zastępują. Pozostałe braki opisuje rejestr. Nie ma produkcyjnego APK bez konfiguracji podpisu; testowy workflow Android zatrzymał się na konfiguracji SDK, bez ujawnienia dokładnej przyczyny. Nie twierdzimy, że JARVIS został przetestowany na komputerze użytkownika.

Instalacja właściwej wersji i rollback: `docs/WYDANIE-ALPHA.md`. Używaj dotychczasowego lokalnego klucza właściciela, ponieważ gotowe paczki CI używają wystawcy repozytorium. Nie instalowano Xvfb ani usług systemowych.

# Kontynuacja alpha.4 — 2026-11-06

Poprawiono podmianę katalogu podczas odczytu. Na bazie 8675cd6 deterministyczna podmiana między lstat a open dopuściła obcy zasób; poprawka odrzuca zmianę tożsamości, utrzymuje deskryptory do końca odczytu i ogranicza liczbę podkatalogów do 255. Dodatkowy test odrzuca podmianę korzenia po wyliczeniu plików. Po ostatniej zmianie: 67 testów Skills, sandboxa, STOP, monitoringu i instalatora PASS; pełna regresja 3101/3101 PASS w 373 plikach, lint i build PASS. `evidence/alpha4-validation.json`. `evidence/alpha4-race.json`.

Kontrolowany przebieg normalnym polem rozmowy: wyszukiwanie → inspekcja → kwarantanna → test → aktywacja → wykonanie w rzeczywistym sandboxie → zapis i odczyt przez JARVIS → niezależny odczyt pliku PASS. Kandydat pochodził z lokalnego katalogu zeskanowanego przed rozmową; dostawca modelu i transport były kontrolowane. Ta próba nie dowodzi samodzielnego rozpoznania brakującej zdolności ani pobrania nowego skilla podczas rzeczywistego zadania. Brak prawdziwej Ollamy i natywnej sesji Electron oznacza BLOCKED dla pełnego odbioru. `evidence/alpha4-controlled/REPORT.md`.

Monitoring i ntfy: kontrolowane kontrakty HTTP, zapis, restart, odwołanie i niepewny wynik powiadomienia przeszły testy. Nie testowano prawdziwej usługi ani rzeczywistego modelu. Na etapie alpha.4 klient MCP nie implementował wyszukiwania nowych serwerów, a adapter changedetection nie tworzył watcha. Potwierdzenie opublikowanego alpha.4 opisano powyżej.

# JARVIS — wdrożenie, odbiór i przekazanie

## Dostarczona wersja alpha.3 — 2026-11-06

**Publiczny prerelease:** https://github.com/Talent620/Jarvis/releases/tag/v2.1.0-alpha.3 . Kod i paczki: `9b21a9d274fbedf30a3ce66ebd85c6415c7b64b9`; obiekt anotowanego tagu: `607952531aef05442e0f9e3eb4658d0602780407`. Baza: `fb17f9755faad72295cb125563ba2b0220d9319d`. Gałąź `codex/skills-integration-20261105` zawiera następnie wyłącznie zapis przekazania i dowody. Nie scalono main ani nie przesunięto latest lub tagów alpha.1/alpha.2.

Pobrano wszystkie **9 plików wydania**. Sumy, identyczny ASAR obu instalatorów, 17 modułów Electron i 5 dokumentów odpowiadają świeżej kopii taga. Publiczny punkt i odcisk wystawcy oraz ładowanie zależności: PASS. `HANDOFF-ALPHA3.json` zawiera pełne 1613 plików i 215 zmian (170 nowych, 45 zmodyfikowanych), hashe, pochodzenie i kontrolę Git fsck. **SHA256 manifestu: `4d96d0206d69a27ee8eb7425f3ef2f2a5cfdc8cfa26ebefc7ba6e014d50314fc`.** Dowody i mapowanie dostarczonych plików: `evidence/published-alpha3/EXPORTS.json`. Kod i pliki są dostępne na GitHubie. Niezależna kontrola eksportu: 256/256; kontrola publicznych zasobów: 103/103.

**3099/3099 testów lokalnie.** Dokładny tag ma GitHub Ubuntu 42135348137 SUCCESS (testy, lint, build, pakowanie i publikacja); końcowa gałąź ma Tests 42135299865 SUCCESS. Przyczyna wcześniejszych awarii startu Chrome w CI pozostaje nieustalona. Późniejszy PASS nie jest przedstawiany jako ich naprawa. Wymagany sandbox, limity i pierwotne asercje pozostały włączone.

**Pełny odbiór produktu nadal niezaliczony.** A/B: BLOCKED — brak Ollamy na 11435/11434. C i obie próby uruchomienia pobranych paczek: BLOCKED — brak X/DISPLAY. Komenda lokalna, ustawienia, restart i testowa aktywacja licencji przez zwykły interfejs: PASS; runner zakończył się kodem 2. Nie wykonano instalacji ani testu na komputerze użytkownika, migracji, rollbacku, rzeczywistych kanałów lub 12 zadań generalizacji. Android nie został wydany bez zatwierdzonej konfiguracji podpisu. Braki implementacji i 32 zgłoszenia pełnego audytu npm pozostają w rejestrze niezależnie od środowiska. PR nie powstał: ponowna próba API zwróciła Forbidden. Publikację wykonał istniejący autoryzowany workflow.

**Aktualizacja z własnym kluczem:** `docs/WYDANIE-ALPHA.md` zawiera gotowy blok dla Ubuntu/Debian x86_64, Git, Node.js >=20, npm, sudo i sesji graficznej. Zamknij poprzednie okno, zachowaj pakiet i profil do wycofania aktualizacji oraz użyj tej samej lokalnej pary (`JARVIS_OWNER_KEY_DIR` przy niestandardowej lokalizacji). Gotowe paczki używają wystawcy repozytorium; licencja podpisana inną lokalną parą wymaga własnego buildu. Uruchamiany plik to `/opt/JARVIS/jarvis-ai-assistant`. Instalator sprawdza helper przed ustawieniem `root:root 4755`; nie wyłącza sandboxa ani AppArmor. Licencja pozostaje wymagana.

Pełny wynik przekazania, rzeczywiste adresy i sumy: `delivery-alpha3.json`, `SHA256SUMS-ALPHA3`. Dalsza część raportu jest historią etapów i ich ograniczeń; migawki sprzed publikacji nie zastępują powyższego stanu.

## Bieżący etap 2.1.0-alpha.3

Baza: `fb17f9755faad72295cb125563ba2b0220d9319d`. Gałąź: `codex/skills-integration-20261105`. Wszystkie wcześniejsze poprawki są zachowane. Aktualna specyfikacja: `SPEC-CLOSURE.md`; jeden rejestr możliwości, integracji, T01–T18 i G1–G10: `requirements.json`. Historyczne 60 testów i 80 przykładów nie zostały przepisane na PASS.

**Końcowa regresja: 3099/3099 PASS w 373 plikach, lint PASS.** Ostatni build produkcyjny przeszedł; `release:linux` ponowi go z finalnego czystego commitu. Włączono rzeczywiste testy OS przez `JARVIS_TEST_SKILL_SANDBOX=1`. To wynik testów kodu i kontrolowanych integracji, nie wynik 3099 zadań autonomicznego modelu. Źródła i pełny log końcowego przebiegu identyfikuje `evidence/alpha3-full-3099.json`; wcześniejsze3094PASS są w `evidence/alpha3-final-validation-source.json`; wcześniejsze3091PASS są w `evidence/alpha3-validation-source.json`. Poprzedni przebieg3089PASS zachowano osobno. Przebieg 3082 sprzed poprawki granicy przeglądarki zachowano osobno. Poprzedni przebieg 3074 PASS zachowano w `evidence/closure-validation-source.json`. Początkowe 2 FAIL i nieobsłużone odrzucenie pozostają w `evidence/closure-integration-first.log`: niezgodny z Samsung S9 regex zastąpiono zgodnym; test STOP czeka teraz na rzeczywiste pytanie o zgodę, zachowując wszystkie asercje odmowy późnej akcji i zapamiętania zgody.

Pełny cel nie jest ukończony i nie ma odbioru 10/10. Prawdziwy model, pulpit, kanały produkcyjne, komplet dokumentów i wszystkie ekrany mają oddzielne braki. Ten plik jest migawką źródeł przygotowaną przed publikacją. Pełny SHA konkretnej paczki podaje jej `PROVENANCE.json`; dowód późniejszego pobrania i końcowy status publikacji znajdą się na gałęzi integracyjnej w `delivery-alpha3.json`. Nie traktuj planowanego tagu jako dowodu dostępności instalatora.

### Konkretne zmiany

- **Linux installer:** log użytkownika dowodzi instalacji alpha.1 i FAIL uruchomienia helpera. Źródłem była decyzja o trybie 0755 na podstawie próby `unshare` wykonanej jako root. Nowy Debian postinst kontroluje chronione katalogi, własność i sumę helpera przed ustawieniem root:root 4755. Nie wyłącza sandboxa/AppArmor ani nie zmienia sysctl. Testy 12/12 i rzeczywiste generowanie szablonu electron-builder: `sandbox-installation-alpha2.json`.
- **Natywne Agent Skills:** katalogi źródeł, bezpieczny YAML, zasoby, kwarantanna, test, polityka właściciela, przypięte wersje/hash, rollback i revoke w istniejącym wykonawcy. Model nie nadaje polityki. Import lokalny używa przypiętych deskryptorów Linux, ogranicza rozmiar/głębokość i odrzuca symlinki/hardlinki. Aktualizacja nie zmienia wersji trwającego zadania. Zakończenie zwalnia przypięcia; trwałe cele zachowują ich tożsamość po wznowieniu.
- **Kod umiejętności i generowane narzędzia:** bubblewrap+seccomp, stdin/stdout, bez sieci, sekretów, zapisów hosta, dodatków natywnych i potomnych procesów; limity czasu/CPU/pamięci/plików. Legacy generated_tool tworzy kwarantannę w tym samym menedżerze. Rzeczywiste próby utworzenia, testu, aktywacji, nowego wejścia i revoke: `evidence/closure-skill-isolation.json`. Backend wymaga Linux x86_64 i istniejących Node/bwrap/prlimit; nie wykonuje dowolnego Python/shell.
- **Przeglądarka i MCP:** prawdziwy Playwright z odrębnym kontekstem, dokładnym origin, DOM, draft/fill, zgodą na faktyczne żądanie i ograniczonym pobraniem. STOP uwzględnia start przeglądarki i późne zgody; szkice nie wysyłają GET beaconów. Bezpieczne pobrania używają deskryptorów plików Linux. MCP odwołuje katalog/zgody, przerywa transporty i odrzuca późne wyniki. `browser-mcp.json` rozdziela rzeczywisty Chromium/stdio od mocków JSON HTTP i modelu. Cua Driver nie jest zainstalowany; dokumentację i ograniczenia oceniono, istniejący X11 jest osobną, wymagającą odbioru ścieżką.
- **Trwałe monitory:** changedetection.io dla konkretnej istniejącej obserwacji oraz ntfy dla jawnie skonfigurowanego serwera/tematu. Tokeny pozostają w chronionym magazynie main. Usunięcie integracji odcina aktywne żądania i spóźnione wyniki; przerwany POST ma stan UNCERTAIN. W istniejącym schedulerze harmonogram dzienny/tygodniowy/miesięczny Europe/Warsaw, DST i pojedyncze nadrabianie po luce. `connector-tests.json`:38 PASS na kontrolowanych kontraktach HTTP, realnym magazynie i procesach; bez kontaktowania rzeczywistych odbiorców.
- **UI i sterowanie:** Skills i przeglądarka w istniejących Ustawieniach, konektory w istniejącym panelu Celów. Zapytanie filtruje kandydatów, STOP pozostaje dostępny podczas pracy, zgoda jest sprawdzana również po oczekiwaniu. Ustawienia/preferencje nie są już procentem sprawności agenta; licznik audytu nie deklaruje ukończonych zadań ani niezmierzonych oszczędności czasu.

### Dowód rozmowy i granice modeli

`evidence/closure-composer/REPORT.md`: zwykłe pole rozmowy → istniejący brain/provider loop → search/inspect/stage/test/activate/run → rzeczywisty sandbox → zwykła zgoda → zapis/odczyt przez narzędzie JARVIS-a → niezależny odczyt dysku. Wynik PASS. Licencja była wymagana i normalnie aktywowana efemerycznym wystawcą QA; prywatny klucz nie został zapisany. Decyzje dostawcy są jawnie kontrolowane, a transport native w tym teście jest testowy. Nie jest to dowód autonomii rzeczywistej Ollamy ani natywnego IPC Electron.

Osobny `evidence/closure-skill-source.json` potwierdza pobranie prawdziwego, wcześniej nieobecnego katalogu Superpowers, porównywalnych kandydatów, przypięty commit, licencję, zasoby, kwarantannę, politykę i ponowne użycie niezmiennej wersji. `STATIC_ONLY` jest kontrolą instrukcji, nie wykonaniem celu. Nie łączymy tych dwóch odrębnych prób w fikcyjny pełny PASS T01.

Rzeczywisty `qa:desktop` zachowuje wymagania A–C i osobny wynik niezależnej licencji/komendy/ustawień/restartu. Pierwszy aktualny przebieg wykrył błąd oczekiwania testu na ekran ładowania zamiast właściwych Ustawień; został zachowany jako FAIL, a helper poprawiono bez przepisywania ustawień ani pomijania asercji. Końcowy run `2026-11-05T22-45-10-284Z-desktop-6f783a46`: niezależna komenda/ustawienia/restart oraz licencja PASS; A/B/C BLOCKED, kod 2. Dowody: `evidence/closure-desktop/REPORT.md`.

### Nieukończone wymagania

- Brak osiągalnej Ollamy w tej maszynie na sprawdzonych 11435/11434; brak potwierdzonego realnego routingu, nowych 12 parafraz i odbioru model → narzędzie → plik. Zestaw odbiorczy H01–H12 jest zapisany w rejestrze, bez reguł rozpoznających wyłącznie te frazy.
- Brak autoryzowanej sesji użytkownika; nie wykonano jego pulpitu, schowka/fokusu, natywnej instalacji/migracji/rollback, telefonu ani głosu. Nie instalowano Xvfb.
- Brak skonfigurowanych rzeczywistych changedetection/ntfy/kont. Kontrolowane usługi nie zaliczają ich produkcyjnego działania. Nadal brak pełnego adaptera rynku Allegro; `changedetection` nie jest takim adapterem.
- Ogólne jednorazowe plany nadal wymagają renderera; nie wszystkie subskrypcje kont, dokumenty XLSX/DOCX/prezentacje/OCR, Wayland, globalne przejęcie pulpitu i istniejące ekrany mają implementację lub odbiór.
- Cua jest opcjonalną, nieskonfigurowaną ścieżką. Hermes/OpenClaw/BrowserUse/OpenHands nie zostały uruchomione jako konkurencyjni agenci. Istniejący webhook n8n zachowano, ale nie zaliczono realnego workflow. Rejestr zawiera przypięte źródła, licencje i konkretne decyzje integracyjne.
- Produkcyjny npm audit: 0, pełny: 32 (14 moderate, 15 high, 3 critical), w tym Electron 33 klasyfikowany jako dev, lecz dystrybuowany w aplikacji. Nie ogłaszamy pełnego audytu jako PASS. Większa migracja runtime nadal wymaga osobnej weryfikacji.

### Weryfikacja pakietów i rzeczywistego CI

Z czystego `d28089e18a2b3c40f1c1c6580786902ef5a50829` zbudowano prawdziwe `.deb` i AppImage. Niezależne rozpakowanie potwierdziło identyczny `app.asar`, pliki natywne, pełny SHA, wersję, wymaganą licencję i obecność nowych zależności. Suma helpera pasuje do rachunku pakietu, a rzeczywisty postinst zawiera zabezpieczenia. Próba startu wyodrębnionej aplikacji z nowym profilem i sandboxem: BLOCKED po `Missing X server or $DISPLAY`. Nie wykonano instalacji systemowej. Dowód: `evidence/alpha2-packages-d280.json`; jest to sprawdzenie pierwszych lokalnych paczek, nie zastępstwo weryfikacji przyszłych opublikowanych plików.

Pierwsze GitHub Actions dla tego commitu miały FAIL. Fixture instalatora przypadkowo korzystał z prawdziwych praw `/opt` runnera. Oddzielono kontrolowane przodki od prawdziwych plików tymczasowych i dodano test odmowy katalogu 0777; produkcyjny instalator pozostał bez zmian. Testy pakowania po poprawce: 13/13 PASS. Końcowa pełna regresja 3082 PASS objęła tę poprawkę i wymagane rzeczywiste testy sandboxa/przeglądarki. Testy prawdziwego Chromium wymagają próby uruchomienia rendererów dostępnych przeglądarek z sandboxem. Brak działającej trasy nadal kończy wymagany test CI błędem z raportem BLOCKED, a dowód jest zachowywany przez workflow. Nie usunięto pięciu asercji integracyjnych.

Android release zgłosił brak siedmiu wymaganych sekretów/zmiennych, wymienionych w instrukcji wydania. Android v2 zakończył się w `Setup Android SDK`; publiczna strona nie udostępniła pełnego wyjątku, więc dokładna przyczyna pozostaje nieustalona. Dowód rzeczywistych uruchomień, adnotacji i poprawek: `evidence/alpha2-ci-first.json`. Nie traktować lokalnego braku SDK jako dowodu przyczyny awarii zdalnej.

### Poprawka granicy zgody i przekierowań przed tagiem

CI dla `577e450` dało Ubuntu PASS (testy, pakowanie i artefakty), ale Tests FAIL: formularz otrzymał dwie zgody zamiast jednej. Publiczna adnotacja nie identyfikowała dodatkowego żądania. Kontrolowana reprodukcja w prawdziwym Chromium wykazała, że opóźniony GET szkicu może wejść do zgód podczas kliknięcia i dotrzeć do serwera. Osobno odtworzono przekierowanie do nieautoryzowanego origin oraz błędny wynik `ok:true` po odmowie, mimo zerowego licznika POST. Tag tej wersji nie został opublikowany.

Poprawka rezerwuje przed oczekiwaniem na zgodę jedno żądanie nawigacji głównej ramki. Żądania w tle i ramki nie dziedziczą tej zgody. Rzeczywisty Chromium zatrzymuje odpowiedzi przekierowań przed przetworzeniem Location; jego DNS, TLS, cookies i sandbox pozostają aktywne. Stare callbacki są przypięte do własnej sesji. Odmowa zwraca `APPROVAL_DENIED`, a zatwierdzony POST z niepotwierdzonym skutkiem zwraca `BROWSER_EFFECT_UNCONFIRMED` i polecenie sprawdzenia stanu przed ponowieniem.

Focused: 23/23 PASS, w tym 12 rzeczywistych scenariuszy Chromium. Niezależne liczniki serwerów potwierdzają brak szkicu GET i żądań do nieautoryzowanych celów, zero POST po odmowie oraz dokładnie jeden rozpoczęty POST w przypadku niepewnego skutku. Nie osłabiono pierwotnej asercji jednej zgody. `browser-transaction-boundary.json` zachowuje reprodukcje przed poprawką i wyniki po niej. Wysyłka SPA/fetch/XHR, iframe i automatyczne podążanie za przekierowaniami nie są obsługiwane przez tę ograniczoną ścieżkę; nie deklarujemy ogólnego rozwiązania wszystkich stron.

### Bramka wydajności i alpha.3

Tag `v2.1.0-alpha.2` pozostał niezmieniony. Jego UbuntuCI42130379821 zatrzymało publikację: 30 cykli prognoz dla1000leadów zajęło3201ms przy progu<3000ms. Pakowanie i publikacja tego runu zostały pominięte; GitHubReleasealpha.2 nie powstał. Próg i wszystkie wcześniejsze asercje zachowano.

Dziennik wielokrotnie skanował globalną historię i kopiował rosnące tablice. Zastąpiono to indeksami historii poszczególnych klientów i śledzeniem oczekujących prognoz, zachowując kolejność dowodów i kompaktowania. Lokalny benchmark w tym samym procesie, z rozgrzewką i pięcioma naprzemiennymi parami, dał mediany281,4ms→30,6ms. Pełne wyniki każdego z30cykli miały identyczne hashe. Nie odtworzono lokalnie przekroczenia3000ms; lokalny baseline również przechodził. Kod bazowy modułu jest identyczny zfb17, lecz nie jest to dowód jego czasu na runnerzeCI.

95testów predykcji,163kontrolowane porównania semantyczne i pełna regresja3091PASS zachowują dane, kolejność, rozstrzygnięcia, idempotencję i duplikaty. Dowód: `ledger-performance.json`. Nowe wydanie ma wersjęalpha.3, ponieważ nie przepisujemy istniejącego tagu. Rzeczywisty nowyCI i paczki są odrębnymi etapami odbioru.

### Końcowa kontrola wystawcy i CI alpha.3

GitHub Tests42131810647 oraz Ubuntu42131810693 dla08e02d5 zakończyły się PASS, łącznie z niezmienioną bramką wydajności i pakowaniem. Dowód: `evidence/alpha3-ci-08e02.json`. Świeży klon GitHub i niezależne rozpakowanie porównały wszystkie17modułów Electron z lokalnymi paczkami; `evidence/alpha3-packages-08e02.json` i `evidence/alpha3-package-source-08e02.json`. Ten wcześniejszy build nie jest automatycznie finalnym opublikowanym artefaktem.

Końcowa kontrola została rozszerzona: Vite zapisuje publiczny punkt i odcisk wystawcy, a release sprawdza poprawność P-256, brak materiału prywatnego oraz zgodność źródła i paczki. Domyślnego wystawcy nie zmieniono. Niezależne Node/WebCrypto i równanie krzywej potwierdziły identyczny poprawny punkt na bazie i08e02d5 (`evidence/alpha3-public-authority.json`). Wcześniejsze podejrzenie niepoprawnego klucza było błędem diagnostycznego regexu, który odczytał `kty` zamiast `y`; nie jest dowodem usterki produktu. Poprawiono diagnozę bez wymiany klucza.

37focused testów licencji/pakowania i pełna regresja3094PASS potwierdzają dodatkową kontrolę. Dwa testy przed poprawką odtworzyły brak odrzucenia niekompletnych/prywatnych metadanych wystawcy; po poprawce poprawny domyślny oraz testowy lokalny wystawca przechodzą. Udany import publicznego punktu i flaga wymaganej licencji nadal nie dowodzą posiadania prywatnego klucza ani aktywacji konkretną licencją użytkownika. Właściciel zachowuje swoją parę lokalnie. Rzeczywisty `install-local --desktop --build-only` z odrębną efemeryczną parą QA zakończył się PASS: publiczny klucz buildu zgodny z wystawcą, CLI sign/inspect i niezależna weryfikacja podpisu PASS, podmieniona treść odrzucona. Nie instalowano aplikacji ani nie wykonywano natywnej aktywacji; prywatny materiał QA usunięto. Dowody: `evidence/alpha3-owner-build.json` i log.

### Kontrola finalnego commitu3ee898c

Czysty3ee898c zbudował obie paczki lokalnie. Ich identyczny ASAR, 17modułów, wersja, commit oraz poprawny publiczny wystawca w metadanych iPROVENANCE zostały niezależnie sprawdzone (`evidence/alpha3-packages-3ee898.json`, `evidence/alpha3-package-source-3ee898.json`). Rzeczywisty ponowny `qa:desktop` na tym commicie: normalna komenda, ustawienia, restart/odtworzenie oraz podpis/aktywacja/reload licencji PASS; A/B BLOCKED brakOllamy11435/11434, C/native BLOCKED brakX/DISPLAY, exit2. `evidence/desktop-3ee898/REPORT.md` i sumy zachowują dowody bez profilu, tokenów i kluczy.

GitHub Tests42133074964 iUbuntu42133074898 na3ee898c zakończyły się FAIL: próba sandboxowanego `/opt/google/chrome/google-chrome` zwróciła `UNEXPECTED_PROBE_FAILURE`. Nie zaliczono przeglądarki ani pominiętego pakowaniaCI. Publiczne adnotacje nie zawierają źródłowego błędu Playwright; pełne logi wymagają logowania, a wskazane anonimowe adresy kroków zwracają404. Dowody: `evidence/alpha3-ci-3ee-failed.json`, `evidence/alpha3-ci-3ee-log-access.json`. Nie przypisujemy nieznanej przyczyny zmianie licencji ani nie uznajemy kolejnego przebiegu za jej naprawę bez dowodu. Zmiana wyłącznie diagnostyczna zachowuje bramkęREADY, wszystkie asercje, sandbox i odrzucenie nieoczekiwanego błędu. 27focusedPASS (w tym12rzeczywistych scenariuszy Chromium), lintPASS oraz rzeczywisty kontrolowany proces zakończony73 potwierdzają raportowanie błędu bez ujawnienia syntetycznych sekretów. Dowód: `evidence/alpha3-browser-diagnostics.json`. Nie jest to naprawa nieznanej przyczyny CI. Dodano `tests/**` do ścieżek istniejącego workflow Ubuntu, aby zmiana testów też uruchamiała jego bramkę.

### Diagnostyczny przebieg6f719e1

Pełna lokalna regresja3098/3098PASS,373pliki,0skip (`evidence/alpha3-full-3098.json`). Kod aplikacji i budowania identyczny z3ee898c. GitHubTests42133889562 PASS; Ubuntu42133889657 FAIL na etapie `launch` Chrome. Publiczna adnotacja zawiera trzy błędy D-Bus i trzy komunikaty fontów o mtime, lecz nie główny wyjątek ani kod wyjścia procesu. Nie uznajemy tych ostrzeżeń za ustaloną przyczynę. Dowody: `evidence/alpha3-ci-6f719.json`, `evidence/alpha3-ci-6f719-annotations.json`. Uzupełnienie raportowania zachowuje główny wyjątek i kod wyjścia przed powtarzalnym stderr, bez zmiany sandboxa, timeoutów, gotowości ani fallbacku. Wydanie nadal wymaga zielonej bramki Ubuntu. Test regresji raportowania najpierw odtworzył1FAIL/10PASS, następnie28focusedPASS (w tym12realChromium) potwierdziło zachowanie głównego wyjątku i kodu wyjścia w pierwszych240znakach. `evidence/alpha3-primary-diagnostics.json`.

### Zielona bramka kandydata44eeb3d

Dla `44eeb3d5082dba934e94027abb2748d7a52c7538` GitHubTests42134605052 iUbuntu42134604873 zakończyły się SUCCESS, włącznie z pełną regresją, lintem, licencjonowanym pakowaniem oraz uploadem artefaktów. `evidence/alpha3-ci-44eeb3d.json`. Lokalnie3099/3099PASS w373plikach bezpominięć (`evidence/alpha3-full-3099.json`). Timeouty, sandbox i wszystkie pierwotne asercje pozostały bez zmian. Nie ustalono pierwotnej przyczyny awarii startu Chrome na3ee/6f; diagnostyczne zmiany nie są przedstawiane jako jej naprawa. Ten pozytywny przebieg potwierdza wyłącznie własny wynik.

Kandydat do tagu zawiera następnie wyłącznie tę aktualizację dokumentacji i dowodów; kod aplikacji, skryptów budowania oraz testów jest taki sam jak w44eeb3d. Istniejący tagowy workflow nadal musi wykonać wszystkie bramki przed publikacją. Ostateczny commit pakietu oraz sumy należy odczytać z rzeczywiście pobranych PROVENANCE/SHA256SUMS, nie z poprzednich lokalnych paczek3ee.

### Uruchomienie i wycofanie

Instrukcja `docs/WYDANIE-ALPHA.md` opisuje dokładny tag, odrębny checkout, budowanie/instalację z zachowaniem lokalnego wystawcy, QA, wymagania oraz wycofanie. Gotowe paczki CI używają wystawcy repozytorium; nie należy przedstawiać ich jako zgodnych z licencją podpisaną inną lokalną parą. Klucz prywatny i dane użytkownika nie są dołączane.

Nie nadpisano lokalnego repozytorium ani danych użytkownika. Nie wykonano merge do main, force-push, instalacji usług, pobierania modeli ani testowych wysyłek do prawdziwych osób. Przeniesienie kodu, wyniki CI i adresy Release wymagają sprawdzenia rzeczywistych zdalnych artefaktów, a nie samej ścieżki `/workspace`.

## Historia poprzedniego etapu alpha.1

Poniższe zapisy opisują poprzedni etap i jego ówczesne ograniczenia. Stan aktualny znajduje się powyżej oraz w `requirements.json`.


Stan: **częściowa implementacja zweryfikowana warstwowo; pełny cel nieukończony**. Pełna regresja: **2976 PASS / 0 FAIL, 364 pliki**, lint i build PASS. Obie paczki Linux z commitu `e295f95e3a867de67a8aedb94f1452e0b92cf21c` zbudowano i sprawdzono; natywny start pozostaje BLOCKED. Kod i tag `v2.1.0-alpha.1` są na GitHubie. CI Tests/Ubuntu PASS, Android/Android v2 FAIL bez ustalonej pełnej przyczyny. Utworzenie PR i Release blokuje API Forbidden — szczegóły w `delivery.json` i końcowym checkpointcie poniżej. Baza integracji to `f74705166e484f9fe76a9ecac7212a45376254ba`, gałąź `codex/durable-autonomy-20261105`. Baza zawiera wcześniejsze commity `0320d50`, `155a2e1`, `367f3d4` i `f747051`: STOP/anulowanie zgód, komendy lokalne, wyniki częściowe, model/status/nagłówek, trwałość celów, licencje właściciela/APK, lokalny instalator i wspólny runner QA. Nowsza specyfikacja autoryzuje push na dedykowaną gałąź, PR, CI, tag i Release. Nie autoryzuje force-push, wyłączenia zabezpieczeń, instalacji Xvfb, zakupów ani kontaktowania sprzedawców.

## Źródło prawdy i granice wyników

`requirements.json` zawiera oddzielne pola implemented, configured, authorized, tested i available dla wspólnych możliwości oraz mapowanie wszystkich 80 przykładów. `EX-01`–`EX-80` są przykładami odbiorczymi, a nie nowymi specjalnymi komendami. Samo mapowanie nie zalicza testu. Test kontrolowanego źródła lub selektora narzędzi nie oznacza zaliczenia naturalnego polecenia przez prawdziwy model.

Historyczne `../results60.json` pozostaje niezmienione, z identyfikatorami `JARVIS-01`–`JARVIS-60` i sumą kontrolną w rejestrze. Nowe dowody mają własny poziom i identyfikator; nie przepisujemy historycznych BLOCKED na PASS na podstawie istnienia kodu lub liczby unit testów. Pełne A/B/C/D, model i urządzenia są oddzielone od testów jednostkowych i kontrolowanych integracji.

## Inwentaryzacja aktywnych obszarów

| Obszar | Istniejąca ścieżka | Ustalona granica |
|---|---|---|
| Wykonawca | agentPlanner → agentPipeline → agentRun → goalRuntime/goalState | Checkpointy narzędzi i wyniki są odrębne od goalPlanner.ts, który komponuje odpowiedzi modeli. Jednorazowe plany nadal wymagają działającego renderera. |
| Pamięć | memory.ts, memoryService.ts, contextCurator.ts | Istnieje odczyt i zapis; pełne pochodzenie, konflikty i retencja nie mają kompletnego odbioru. |
| Narzędzia | tools.ts, workspace-tools.cjs, skills.ts | Pliki/procesy/API i rejestr umiejętności istnieją. generated_tool odmawia wykonania bez zweryfikowanego sandboxa OS. |
| Modele | providers/ollama.ts, modelRouter.ts, toolSelector.ts | Faktyczny endpoint i funkcjonalne możliwości wymagają osobnych prób; nazwa modelu i „cześć” nie są dowodem. |
| Pulpit | desktop.ts, electron/main.cjs, linux-keyboard.cjs | Backend zależy od sesji i dostępnych narzędzi; test X11 nie dowodzi Wayland. |
| Przeglądarka | public-page.cjs, page-extract.cjs, research.ts | Publiczny odczyt, otwieranie URL i konfigurowalne wyszukiwanie; brak dowodu pełnego DOM, paginacji i dowolnych formularzy. |
| Oferty | bargain.ts, bargainWatch.ts | Istnieją linki Allegro i ręczny tracker cen. Nie jest to trwały adapter rynku Allegro. |
| CRM/projekty | SalesCrm.tsx, crmBuckets.ts, leads.ts, Projects.tsx | Kod istnieje; brak nowego pełnego polecenia rzeczywistego modelu na danych testowych. |
| Finanse | finance.ts, FinancialDashboard.tsx, MoneyHub.tsx | Czyste obliczenia są zaimplementowane; automatyczny miesięczny obieg faktur jest oddzielnym wymaganiem. |
| Site OS | siteOs.ts, WebStudio.tsx, site-os/server.mjs | Istniejący serwer i UI; tworzenie strony przez model wymaga odbioru. |
| Zadania | TaskHub.tsx, GoalStatusPanel.tsx, goalControl.ts | W istniejącym panelu integrowany jest trwały monitor; nie powstaje kolejny panel ani LLM „mózg”. |
| Głos | voice.ts, transcribe.ts, voiceConsent.ts | Wymaga rzeczywistego mikrofonu/głośnika i skonfigurowanego dostawcy. |
| Ustawienia/UI | App.tsx, Settings.tsx, InterfaceSwitch.tsx | Istniejące tryby zachowane. Pełny odbiór każdej kontrolki nie został wykonany. |
| Mobile | Android MainActivity/AccessibilityService, sync.ts | Kod natywny nie oznacza stale aktywnego monitora ani sparowanego nowego kanału alertów. |
| Licencje/aktualizacje/pakowanie | license.mjs, install-local.cjs, updater.ts, electron-builder.json, workflows | Tożsamość wystawcy zachowana. Gotowy instalator wymaga oddzielnego zbudowania i sprawdzenia; źródła nie są instalatorem. |

## Allegro i rzeczywiste źródła

Próba odczytu oficjalnej dokumentacji `https://developer.allegro.pl/documentation/` przez skonfigurowany proxy zakończyła się `CONNECT tunnel failed, response 403` (curl 56). Dowód: `allegro-access.json`. Nie sprawdzono bieżącego uprawnienia do `GET /offers/listing`, nie skonfigurowano OAuth ani konta. Nie używano zdarzeń własnych ofert jako strumienia rynku. Nie sprawdzono też aktualności natywnych ulubionych wyszukiwań/powiadomień.

Brak adaptera Allegro to **MISSING_IMPLEMENTATION**. Odmowa sieci jest osobnym **BLOCKED** dla weryfikacji dokumentacji/API. Adapter skonfigurowanego feedu JSON lub katalogu nie powinien być reklamowany jako automatyczne przeszukanie Allegro ani całego internetu.

## Znane brakujące wymagania

Niezależnie od braku modeli lub sesji pozostają: pełny trwały wykonawca dowolnych planów bez renderera; kalendarzowe reguły typu poniedziałek/koniec miesiąca dla ogólnych zadań; kompletne subskrypcje poczty, kalendarza i przesyłek; adapter rynku Allegro; sparowane alerty i komendy telefon↔host; bezpieczny sandbox wygenerowanych narzędzi; pełne XLSX/DOCX/prezentacje/OCR z weryfikacją eksportu; globalna blokada współdzielonego pulpitu i wykrycie fizycznego przejęcia myszy; pełny audyt wszystkich UI. Szczegóły i granice istniejących fragmentów są w `requirements.json`.

Dwanaście nowych parafraz w teście selektora, jeżeli zostaną wykonane, będzie dowodem selekcji narzędzi. Nie będzie dowodem uogólniania planowania przez rzeczywistą Ollamę.

## Zmiany i wykonane testy warstw

- Trwały backend monitora w procesie głównym: atomowy zapis z wersją, blokada procesu i dzierżawy prób, odrzucanie spóźnionych wyników po anulowaniu/zmianie kryteriów, NO_MATCH, limity i retry, atomowe dopasowanie+outbox, deduplikacja. Jest zegar interwałowy, bez modelu podczas oczekiwania. **20 PASS**: evidence/goal-service-tests.log. Test 08:00–14:00 używa kontrolowanego źródła/zegara oraz rzeczywistego magazynu, 361 sprawdzeń, restartu i pojedynczego zdarzenia. Testy obejmują też rzeczywiste dwa procesy oraz SIGKILL po rozpoczęciu wysyłki; niepewny skutek zostaje UNCERTAIN bez ślepego ponowienia.
- Adapter JSON wymaga jawnego kontraktu rekordów i dokładnej zgody na publiczny URL. Adapter katalogu używa przypiętego deskryptora w Linux, czyta wyłącznie nazwy/stat; inne systemy zgłaszają SOURCE_BLOCKED. To nie jest parser dokumentów ani Allegro.
- Monitor jest dostępny w istniejących narzędziach i panelu Cele; grant przechodzi natywny dialog, model nie nadaje uprawnień. **28 PASS**: evidence/bridge.log (React/kontrolowany IPC+rzeczywisty magazyn oraz regresje istniejącego STOP/goalRuntime/klawiatury). Brak zaliczenia natywnego Electron.
- Diagnostyka Ollamy wymaga faktycznego wywołania narzędzia z losowym echo, rozróżnia zainstalowany/załadowany/deklarowane możliwości i ma cache z terminem ważności. Dobór schematów ma budżet, przepełniony prompt i uszkodzone argumenty są odrzucane przed działaniem. **56 PASS**: evidence/model-capabilities-tests.log, kontrolowany HTTP. Jeden test selektora sprawdza 12 nowych parafraz; rzeczywiste uogólnianie przez model nie zostało zaliczone. Osobne próby vision/code/embedding/voice pozostają brakujące.

Zestawy powyżej częściowo współdzielą testy; nie sumować ich jako niezależnych scenariuszy. Końcowy dowód globalny: evidence/full-tests.log, **2976 PASS / 0 FAIL**.

## Wykonana próba rzeczywistego źródła

`real-directory-source.json`: **PASS warstwy backendu** na rzeczywistym, istniejącym katalogu repozytorium i pliku package.json. Użyto rzeczywistego zegara oraz filesystemu, osobnego katalogu stanu i jawnego grantu testowego. Nie wstrzykiwano fetch ani nie tworzono obserwowanego pliku. Niezależnie odczytano zapis goals-v1.json, po ponownym utworzeniu usługi pozostało jedno zdarzenie, a hash obserwowanego pliku nie zmienił się. Wynik to COMPLETED + pojedyncze IN_APP. W dowodzie zapisano hash badanego goal-service.cjs.

Ta próba nie przechodzi przez rozmowę/model, nie jest obserwacją Allegro, nie odczytuje treści dokumentu i nie potwierdza doręczenia powiadomienia systemowego. Jest osobnym sprawdzeniem rzeczywistego adaptera, trwałości i deduplikacji.

## Rzeczywisty runner i pulpit

`desktop.json` dokumentuje wykonanie istniejącego qa:desktop, runID `2026-11-05T21-41-56-138Z-desktop-9540d1ef`: niezależny licencjonowany UI, komenda lokalna, ustawienia/restart oraz wydanie/aktywacja licencji PASS. A/B/C BLOCKED, kod 2: oba lokalne API 11435/11434 odmówiły połączenia, Electron zakończył się SIGSEGV po braku X/$DISPLAY, xdotool nie jest zainstalowany. Mousepad jest dostępny. Xvfb nie uruchamiano ani nie instalowano.

Runner C jest teraz **IMPLEMENTED**, wcześniej był brakującym kodem. Wymaga prawdziwego modelu i normalnego pola rozmowy, zdarzenia kopii z dokładnym zaznaczeniem drugiego akapitu, schowka, fokusu rzeczywistego Mousepada, audytu paste/save/read, niezależnego pliku oraz pasującej odpowiedzi asystenta. Zabrania bezpośredniego zapisu i wpisywania tekstu akapitu zamiast kopiowania. Czyszczenie obejmuje tylko własne okno/proces edytora; nie nadpisuje schowka użytkownika.

Native C pozostaje niewykonany. Discovery/focus X11 i kontrolowany protokół mają testy jednostkowe: 17 PASS. Wayland input pozostaje MISSING_IMPLEMENTATION. Powyższy realny run poprzedza końcowe poprawki fokusu/weryfikacji odpowiedzi; pełna końcowa regresja musi je objąć.

## Konfiguracja i działanie hosta

W istniejącym panelu **Cele → Monitoring i powiadomienia** jest formularz źródła JSON/katalogu, kryteriów, interwału, zakończenia po trafieniu, powiadomień i ciszy nocnej. Nadanie zakresu wymaga natywnego dialogu użytkownika; model nie ma akcji grant. Panel pokazuje sterowanie pauza/wznów/anuluj/zmień kryteria/wycisz/cofnij zgodę oraz zdarzenia z osobnym potwierdzeniem przeczytania przez użytkownika.

Domyślnie zamknięcie ostatniego okna zatrzymuje scheduler. Jawne włączenie trybu pracy po zamknięciu okna, z natywnym potwierdzeniem, pozostawia proces main i timer. Ctrl+Alt+J lub ponowny start przywraca okno. Wyjście z menu JARVIS zawsze kończy proces. Nie włączono autostartu. Uśpiony lub wyłączony komputer niczego nie obserwuje; monitor nie dopisuje historii za lukę. Jednorazowe ogólne cele nadal wykonuje renderer. Natywne zachowanie wymaga jeszcze próby Electron.

## Pakowanie i zależności

Wersja przygotowania: **2.1.0-alpha.1**. Pełny SHA i wersja są widoczne w Ustawieniach. Helper release:linux sprawdza czysty commit, aktywną licencję i zachowanego wystawcę, buduje AppImage/deb, kontroluje ASAR i zapisuje SHA256SUMS. Testy przygotowania pakowania: **5 PASS**, dowód packaging-tests.log. To nie jest jeszcze dowód działania pobranego instalatora.

Po zgodnych aktualizacjach produkcyjny npm audit ma **0** zgłoszeń, ale pełny audit nadal ma **32** (14 moderate, 15 high, 3 critical) w pakietach sklasyfikowanych jako dev/build, w tym Electron dystrybuowany w aplikacji. Zero dla --omit=dev nie oznacza aplikacji bez podatności. Szczegóły wersji i licencji są w packaging.json; nie dodano nowej biblioteki runtime. Nie deklarujemy czystego pełnego audytu. APK pozostaje BLOCKED: brak SDK i zatwierdzonej konfiguracji istniejącego podpisu/versionCode; cichy fallback do klucza deweloperskiego usunięto.

Przycisk aktualizacji nadal obsługuje rolling latest. Alpha wymaga ręcznej instalacji rzeczywistej paczki; nie nadpisuje stabilnego kanału. Instrukcja: docs/WYDANIE-ALPHA.md.

## Publikacja

Dowody rzeczywistych prób uwierzytelnienia/API zapisuje `publication-access.json`. Odczyt Git i odmowa API to różne wyniki. Utworzenie szkicu konfiguracji sieci nie zmienia bieżącej polityki ani nie publikuje Release. Tag, SHA, CI i adresy artefaktów należy wpisać dopiero po rzeczywistym wykonaniu i ponownym pobraniu paczek.

## Regresja integracji

Pierwsza pełna integracja miała **4 FAIL** (evidence/integration-first.log). Jeden test wymagał starego zachowania „niejasne polecenie → cały katalog”, sprzecznego z nowym budżetem kontekstu. Zastąpiono go sprawdzeniem limitu liczby i rozmiaru, wymaganych narzędzi bazowych, wykluczenia nadmiarowych skutków oraz niezmienności pełnych schematów. Trzy próby diagnostyki trafiły na niespójną nazwę pola podczas równoległej integracji; przywrócono zgodny kontrakt i zachowano asercje installed/loadedBeforeProbe. Po korektach i dwóch dodatkowych testach deadline wykonano końcową pełną regresję: **2976 PASS / 0 FAIL, 364 pliki** (evidence/full-tests.log). Pełny lint PASS (evidence/full-lint.log), końcowy dodatek konstruktora timeoutów dodatkowo sprawdzono focused lintem (evidence/goal-service-lint.log). TypeScript/Vite build PASS (evidence/full-build.log); helper wydania ponownie zbuduje renderer i natywne paczki z czystego commitu.

## Checkpoint

Implementacja i testy opisane wyżej mają konkretne dowody. Bieżący dokument nie deklaruje kompletnych 80 scenariuszy, ukończonego wydania ani działania na komputerze użytkownika. Pełna regresja kodu jest zaliczona. Rzeczywisty model/pulpit, natywne instalatory, instalacja/aktualizacja/wycofanie na docelowym systemie i opublikowany Release pozostają osobnymi niezaliczonymi bramkami. Dokładny SHA przyszłego buildu zapisuje wygenerowany po commitcie PROVENANCE; nie wpisujemy zgadywanego SHA do jego własnego commitu.

## Końcowe przekazanie kodu i paczek

Commit kodu i obu paczek: `e295f95e3a867de67a8aedb94f1452e0b92cf21c`, tag `v2.1.0-alpha.1`, wersja `2.1.0-alpha.1`. Gałąź `codex/durable-autonomy-20261105` zawiera dodatkowo późniejszy checkpoint wyłącznie dowodów/dokumentacji; produkt w tagu i paczkach nie zmienił się. Kod oraz tag zostały wysłane i potwierdzone przez ls-remote. Zbudowano rzeczywiste .deb i AppImage; ich rozpakowane app.asar są identyczne, SHA i wymagana licencja poprawne. Dowód: `PACKAGES-VERIFICATION.json`, sumy `SHA256SUMS`. Natywny plik z .deb faktycznie uruchomiono z oddzielnym profilem i sandboxem: BLOCKED po braku X/DISPLAY. Nie wykonano instalacji systemowej ani testu komputera użytkownika.

Ponowny qa:desktop na czystym e295f95: niezależny UI/komenda/ustawienia/restart/licencja PASS; A/B/C BLOCKED, kod2. Dowody w `evidence/final-desktop/`. GitHub Actions: Tests PASS (42116504054), Ubuntu PASS (42116503962); Android i Android v2 FAIL (42116503997 i42116503906), dokładne przyczyny nieustalone bez pełnych logów. Nie utożsamiać ich z lokalnym brakiem SDK.

PR create zwrócił GraphQL Forbidden, Release create zwrócił HEAD API Forbidden. PR ani Release nie powstały; brak URL wydania. Szczegóły w `delivery.json`. Szkic środowiska z api.github.com/uploads.github.com oraz dokumentacją/API Allegro zapisano, ale nie aktywowano. Następna czynność zewnętrzna: przejrzeć/zapisać ustawienia i opublikować środowisko, sprawdzić API, następnie wykorzystać istniejący tag i rzeczywiste artefakty do prerelease, pobrać opublikowane paczki i porównać sumy. Nie generować nowego klucza licencji, nie resetować tagu ani nie force-pushować.

Pełny cel nadal nie jest zakończony. Braki implementacji pozostają w requirements.json, niezależnie od powyższych blokad. Dalszy kod: kalendarzowe wyzwalacze i ogólny wykonawca bez renderera, prawdziwy adapter źródeł ofert, brakujące integracje/izolacja oraz odbiór rzeczywistym modelem i pulpitem. Nie deklarować pracy po zakończeniu sesji.
