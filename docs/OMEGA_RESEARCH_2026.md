# JARVIS OMEGA — diagnoza i plan weryfikacji

Data: 2026-11-05. Punkt wyjścia: commit `964646ae020eb37d8b832c1b625084c49215bd9d` oraz zmiany w tym katalogu roboczym. Materiał użytkownika: „Protokół JARVIS OMEGA READY”. Dane z repozytoriów poniżej sprawdzono na podstawie dostępnych oficjalnych źródeł; dostęp do ogólnej wyszukiwarki i pełnych rankingów nie był dostępny. Ten dokument nie jest niezależnym pomiarem przewagi nad konkurencją.

## Surowa diagnoza

JARVIS posiada funkcjonalne komponenty: desktop, czat, narzędzia, pamięć i kolejkę z zapisem stanu, różne silniki głosowe, interfejs Classic/PRO. To jednak nie jest jeszcze jeden lokalny serwer z jedną pamięcią dla urządzeń ani zmierzony system klasy światowej.

1. Istnieją teraz dwie kolejki o różnych możliwościach. Dotychczasowa kolejka narzędzi (`src/lib/goalQueue.ts`, uruchamiana w `src/App.tsx`) żyje w procesie klienta. Nowa kolejka serwera działa po zamknięciu klienta, lecz wykonuje wyłącznie analizę tekstową lokalnym modelem. Nie przenosi zadań narzędziowych na serwer.
2. Plan i wykonawca mają skończone budżety kroków i wywołań. Nazwy ról nie dowodzą niezależnych agentów; `resultVerifier.ts` sprawdza zapisane statusy i nie przeprowadza niezależnych testów rezultatu. Niezależna weryfikacja kodu i efektów wymaga osobnej implementacji.
3. Uprawnienia i ograniczanie katalogów już istnieją, ale uruchomienie procesu z danym `cwd` nie jest sandboxem. Domyślne kodowanie w odizolowanym środowisku trzeba dopiero zbudować i sprawdzić.
4. Dostawca i klucze nie są dowodem działania modelu; lokalny adres usługi nie jest dowodem lokalnego wykonania. Pełne `local_only`, wspólny wersjonowany RuntimeProfile oraz brak chmurowego fallbacku na wszystkich ścieżkach nie zostały wykazane.
5. Na tym środowisku nie wykryto polecenia Ollama. Nie wykonano testu realnego lokalnego modelu, pełnego polskiego STT/TTS, Windows/Android, parowania, testów T1–T16 ani działania po odcięciu internetu. Nie wolno oznaczać tych scenariuszy jako zaliczonych.
6. W poprzedniej odpowiedzi podano 2827 testów jako dowód działania komponentów. To był wynik testów automatycznych dla wcześniejszego stanu, nie benchmark inteligencji, niezależności, jakości odpowiedzi ani test na komputerze użytkownika. Stwierdzenia o „weryfikacji” należy ograniczyć do faktycznie wykonywanych kontroli.

Szacunkowa ocena dojrzałości względem docelowej wizji: **3/10**, subiektywna i nieporównywalna ze skalą produktów konkurencji. Nie ma wyników pozwalających rzetelnie uszeregować systemy. Zapewnienie pierwszeństwa na 25 lat nie jest obecnie weryfikowalne.

## Pierwsze konkretne poprawki

- `hasUsableBrain` nie uznaje już samego wyboru dostawcy z pustym kluczem za skonfigurowaną ścieżkę i uwzględnia tryb lokalny oraz przekazane ustawienia. Nadal nie jest to rzeczywisty test modelu ani połączenia. Funkcje pomocnicze `askModel` mogą teraz użyć Ollamy w trybie auto bez klucza chmurowego; test wykorzystuje mock, nie prawdziwy model.
- Naprawiono routing BFF dla obsługiwanych dostawców, gdy klucze znajdują się po stronie serwera. Testy sprawdzają rzeczywiste adaptery HTTP na mockowanych odpowiedziach, fallback oraz rozdzielenie trybu on-device od BFF. Nie wykonano testu z rzeczywistym wdrożonym BFF i prawdziwymi kluczami; sam adres proxy nie dowodzi gotowości.
- Log narzędzi workspace nie zapisuje swobodnej treści plików, kodu i argumentów terminala, a typowe pola poświadczeń i dane URL są redagowane. To ogranicza ryzyko, lecz dowolny sekret w nieznanym polu nadal może trafić do logu; historyczne logi nie zostały wyczyszczone. Status jawnie rozróżnia ograniczenia ścieżek od braku sandboxa procesów.

- Dodano `server/runtime`: serwer HTTP na loopback z prywatnym tokenem, profilem żądanym i aktywnym, wyborem zainstalowanego modelu Ollamy, testem odpowiedzi i trwałą kolejką analiz. Stan zadań jest zapisywany atomowo w pliku JSON; zadania mają identyfikatory żądań, statusy, wyniki i anulowanie. Zadania przerwane restartem są przywracane do kolejki, ponieważ ten wykonawca realizuje wyłącznie analizę tekstową.
- Panel „Serwer lokalny” pozwala wybrać model GGUF dostępny w Ollamie, uruchomić test, zlecić analizę i przeglądać jej wynik. Electron odczytuje prywatny plik połączenia, sprawdzając jego uprawnienia. Serwis użytkownika `jarvis-runtime.service` umożliwia dalsze działanie po zamknięciu okna aplikacji, gdy usługa nadal działa. Instrukcja: [LOCAL_RUNTIME.md](LOCAL_RUNTIME.md).
- Metadane GGUF i adres loopback ograniczają wybór, lecz nie dowodzą braku ruchu wychodzącego procesu Ollamy. Samo oznaczenie profilu `local_only` nie jest sieciowym zabezpieczeniem ani dowodem rzeczywistej prywatności. Wybranego modelu i usługę Ollama musi przygotować użytkownik; instalator ich nie pobiera.
- Ostatni pełny wynik przed zmianami serwera: 2835 testów w 331 plikach. Końcowy wynik po dopracowaniu uruchamiania jednym kliknięciem: **2929 PASS w 338 plikach, 0 FAIL, 0 SKIP**. Testy Kompas: 18 PASS; Site OS API: PASS; narzędzia workspace: 10 PASS, 2 NOT_RUN. Wyniki mockowane i testy automatyczne nie są testem rzeczywistego modelu ani urządzeń użytkownika. Szczegóły: [raport walidacji](VALIDATION_2026-11-05.md).

To jest początek wdrożenia, nie pełny przekrój `LOCAL_AUTOPILOT`. Wszystkie scenariusze akceptacyjne T1–T16 z protokołu wymagają osobnego wykonania i w tym audycie mają status **NOT_RUN**.

## Kierunek architektury

- Docelowo jeden serwer Linux jako źródło zadań, zdarzeń, historii i wersjonowanej konfiguracji. Aktualny runtime posiada tylko własny plik stanu dla analiz i profil modelu; SQLite nie jest jeszcze używane. Wspólna historia i stan klientów Windows, Android i desktop pozostają do wdrożenia.
- Rozdzielić żądany profil, faktycznie aktywne komponenty i wyniki testów z datą ważności. Status „READY” wymaga rzeczywistego testu danej funkcji; ustawiony URL, klucz lub proces nie wystarczają.
- Local-only egzekwować w konfiguracji, wykonawcach i sieci, nie wyłącznie w instrukcji modelu. Brak sprawdzonego lokalnego modelu = konkretny stan i instrukcja naprawy, nigdy cichy fallback do chmury.
- Serwerowa trwała kolejka z checkpointami, idempotencją oraz procedurą uzgadniania niejednoznacznych efektów zewnętrznych. Ograniczenie uprawnień i anulowanie poza modelem.
- Kodowanie: izolowane środowisko, jawne zasoby, niezależny zestaw testów, diff i dowody. Żadne nazwy agentów nie zastępują pomiaru ich rzeczywistej niezależności.
- Głos: lokalne STT/TTS, push-to-talk za zgodą urządzenia, priorytet rozmowy i obsługa przerwania; naturalność polszczyzny wymaga odsłuchu i testów na urządzeniach.
- Przed wdrożeniem wielu frameworków porównać prosty pojedynczy proces, architekturę serwer + wykonawca i izolowaną wersję eksperymentalną na tych samych zadaniach i budżetach.

## Kolejność prac i bramki

1. **Uczciwa gotowość i baza pomiarowa.** Poprawić fałszywą dostępność dostawcy; zachować rozróżnienie konfiguracja/zweryfikowane działanie. Zbudować niezmienny zestaw prywatnych i publicznych zadań, w tym po polsku. Zmierzyć wersję bazową.
2. **Pierwszy pełny pion Linux.** Profil lokalny → wykrycie sprzętu → model i rzeczywista odpowiedź → lokalny głos → naprawa błędu w kontrolowanym repo → niezależne testy → raport i prawdziwy status. Model, wersję, licencję i zasoby dobrać po pomiarach. Bez rzeczywistej próby offline T1–T9 pozostają NOT_RUN.
3. **Trwałość i uprawnienia.** Rozszerzyć serwerową kolejkę analiz o bezpieczne wykonawce narzędzi; sprawdzić restart, ponowienia, niejednoznaczne efekty, stop i backup/restore. Istniejąca kolejka narzędzi nadal działa w kliencie. Testować bezpieczeństwo procesu poza ograniczeniem cwd.
4. **Urządzenia.** Parowanie z krótkotrwałymi tokenami, odwołanie, synchronizacja historii i zadań, testy Windows/Android na urządzeniach oraz odzyskiwanie po rozłączeniu. Nie traktować emulacji jako testu fizycznego.
5. **Ulepszanie na dowodach.** Dopiero po bazowej gotowości dodać eksperymenty z hipotezą, budżetem, niezmiennym zestawem oceniającym, porównaniem i rollbackiem.

Proponowany zestaw porównawczy: te same modele, narzędzia, koszty, zasoby, uprawnienia i dane dla wszystkich systemów; zadania z poleceń użytkownika i scenariusze kontrolne; wielokrotne próby. Mierzyć ukończenie zweryfikowane niezależnie, poprawność, skutki nieuprawnione, odzyskanie po awarii, czas, koszt i zużycie zasobów. Wyniki należy opublikować z wersjami i opisem warunków. Żaden wynik nie jest jeszcze dostępny.

## Źródła do konkurencji i ewaluacji

- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) — dokumentacja producenta: agenci, narzędzia, sesje i śledzenie.
- [OpenAI Codex](https://github.com/openai/codex) i [Claude Code](https://github.com/anthropics/claude-code) — punkty odniesienia dla kodowania, nie dowód rankingu.
- [Google Agent Development Kit](https://github.com/google/adk-python) — dokumentacja producenta dotycząca workflow i narzędzi agentowych.
- [SWE-bench](https://github.com/SWE-bench/SWE-bench) — zadania z rzeczywistych zgłoszeń repozytoriów.
- [OSWorld](https://github.com/xlang-ai/OSWorld) i [BrowserGym](https://github.com/ServiceNow/BrowserGym) — ewaluacja zadań w środowisku desktopowym i przeglądarkowym.
- [τ²-bench](https://github.com/sierra-research/tau2-bench) — symulacje interakcji i narzędzi; wersji benchmarku nie należy porównywać bezpośrednio bez wspólnej metodologii. Polskie scenariusze trzeba przygotować osobno.
- [Inspect AI](https://inspect.aisi.org.uk/) — framework ewaluacyjny; użyć tylko wtedy, gdy ułatwi powtarzalność.
- [Model Context Protocol](https://github.com/modelcontextprotocol/modelcontextprotocol) — interoperacyjność narzędzi, bez automatycznej gwarancji bezpieczeństwa.
- [Ollama FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.mdx) — dokumentuje `OLLAMA_NO_CLOUD=1`; zastosowanie i ograniczenie ruchu sieciowego wymagają niezależnego testu.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — kandydat do lokalnego STT, w tym CPU i VAD. README deklaruje MIT dla implementacji; osobno sprawdzić licencję i jakość wybranego modelu.
- [Piper](https://github.com/OHF-Voice/piper1-gpl) — kandydat do lokalnego TTS; implementacja jest na GPL-3.0, a licencję i jakość wybranego polskiego głosu należy zweryfikować osobno.
- [Qwen3-Coder](https://github.com/QwenLM/Qwen3-Coder) — rodzina modeli do sprawdzenia w lokalnym kodowaniu; dobór konkretnego wariantu wymaga pomiaru na sprzęcie użytkownika i sprawdzenia jego licencji.
