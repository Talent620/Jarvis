# Trwała autonomia — rejestr wdrożenia i dowodów

Stan: **częściowa implementacja zweryfikowana warstwowo; pełny cel nieukończony**. Pełna regresja: **2976 PASS / 0 FAIL, 364 pliki**, lint i build PASS. Pakiety oraz publikacja mają osobne, jeszcze niezaliczone bramki. Baza integracji to `f74705166e484f9fe76a9ecac7212a45376254ba`, gałąź `codex/durable-autonomy-20261105`. Baza zawiera wcześniejsze commity `0320d50`, `155a2e1`, `367f3d4` i `f747051`: STOP/anulowanie zgód, komendy lokalne, wyniki częściowe, model/status/nagłówek, trwałość celów, licencje właściciela/APK, lokalny instalator i wspólny runner QA. Nowsza specyfikacja autoryzuje push na dedykowaną gałąź, PR, CI, tag i Release. Nie autoryzuje force-push, wyłączenia zabezpieczeń, instalacji Xvfb, zakupów ani kontaktowania sprzedawców.

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
