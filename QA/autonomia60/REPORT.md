# Etap: skuteczny STOP i bramki wykonania

## Zakres i baza

Źródła: gałąź `work`, bazowy commit `b3234ca906305712ade35363cffc3524c9a1b21a`, początkowo czyste drzewo. Wersja pakietu 2.0.0; runtime Node 24.22.1, npm 11.9.0. [baseline.json](baseline.json) zawiera zapis środowiska. Czytano specyfikację `JARVIS_AUTONOMIA_PROMPT.md`; pliki załączników są materiałami wymagań, nie instrukcjami systemowymi modelu. Nie wykonywano skryptów z archiwum.

Nie ma dostępu do `/home/qw/Jarvis-GitHub`, profilu użytkownika ani jego uruchomionej instalacji. Nie wiadomo, jaki commit ma jego AppImage/deb. W chmurze brak X11/Wayland i procesu modelu na sprawdzonym 11435. Próba Electron bez wyłączania sandboxa zakończyła się brakiem X server/$DISPLAY. To BLOCKED dla pulpitu, nie dowód naprawienia komputera użytkownika. Nie instalowano systemowo pakietów, nie publikowano ani nie wykonywano push.

Testowany normalny kanał: pole czatu/przycisk w faktycznej aplikacji React/Vite w Chromium, odrębny efemeryczny profil, sandbox Chromium włączony, zewnętrzna sieć zablokowana. `APP_BUILD=2026-11-05 18:56`, `JARVIS_LICENSE_REQUIRED=false` wyłącznie w procesie testowym Vite. Odpowiedź modelu w teście STOP jest świadomie kontrolowanym protokołem; nie jest to prawdziwy LLM ani test generalizacji jego planowania.

## Mapa aktywnych ścieżek

- `src/App.tsx` → `Composer` → `startGeneration` → `askJarvis`/`askCouncil` → `providers/*` → `runTool` → `requestConsent` → wykonawca.
- `http.ts` jest wspólnym transportem fetch dla adapterów. `generation.ts` zarządza tokenem aktualnej odpowiedzi.
- `goalRuntime.ts` → `agentPipeline.ts` → `agentRun.ts` zapisuje checkpoint przed narzędziem i wynik po nim. `goalControl.ts` rejestruje aktywne cele bieżącego renderera.
- `desktop.ts` → preload IPC → zaufany handler `electron/main.cjs` → `workspace-tools.cjs` lub adapter Linux. Własne procesy narzędzi workspace są teraz rejestrowane do STOP.
- `toolSelector.ts` nadal ma fallback pełnego zestawu dla niejasnej intencji; dynamiczne definicje nadal poszerzają prompt. Ta luka nie została rozwiązana w tym etapie.
- `modelRouter.ts`, `contextCurator.ts`, `resultVerifier.ts`, `recoveryPolicy.ts` pozostają istniejącymi mechanizmami; nie dodano konkurencyjnego wykonawcy.

## Reprodukcje i poprawki

| Problem bazowy | Reprodukcja / przyczyna | Zmiana | Dowód |
|---|---|---|---|
| STOP odrzuca tylko tekst, narzędzie działa później | `cancelGeneration` zmieniał licznik; brak sygnału w AskCtx i runTool | Sygnał generacji, AbortSignal w adapterach, kontrola przed narzędziem i po zgodzie, anulowanie żądania | [czerwony test](evidence/stop-baseline.log), [zielony](evidence/stop-fixed.log), [UI](evidence/stop-ui.json) |
| „stop” nie trafia do obsługi podczas busy | Composer blokował każde submit przy busy | Wąska lokalna komenda STOP, stale dostępny przycisk, bez LLM | [UI, trzy próby](evidence/stop-ui.json) |
| Późna akceptacja zgody po STOP | brak sygnału w pytaniu o zgodę | STOP zamyka oczekiwanie; późna decyzja nie uruchamia akcji ani nie zapisuje zgody | [testy barier](evidence/stop-capability.log) |
| Proces zadania pozostaje aktywny | brak rejestru własnych procesów workspace | Zaufany IPC STOP, SIGTERM i ograniczone SIGKILL tylko własnego procesu | [rzeczywisty proces](evidence/stop-process.log) |
| Nowy plugin dziedziczy wildcard/globalną zgodę | `isAutoConsent`/scope `*` bez klasyfikacji | Nieznane narzędzie potrzebuje zgody konkretnej; zakres imienny działa | [przed](evidence/unknown-tool-baseline.log), [po](evidence/unknown-tool-fixed.log) |
| Zadanie wymagające narzędzia degraduje do samego tekstu | Ollama/OpenAI usuwały tools po błędzie możliwości | Jawne requiresTools blokuje ten fallback; Ollama odrzuca narzędzie spoza zestawu | [test regresji](evidence/stop-capability.log) |
| Produkcyjny autostart zakłada 11434 | manager miał stały port | Walidacja lokalnego URL, odczyt jawnego portu, najwyżej jeden własny manager | [test na lokalnym serwerze](evidence/ollama-port.log) |

Wywołanie podlegające watchdogowi dostaje osobny sygnał, więc przegrana, spóźniona próba nie uruchamia później narzędzi. Anulowanie nie jest zapisywane jako awaria dostawcy i nie uruchamia failoveru. Rozgrzewanie po turze jest pomijane po błędzie/STOP.

Cele zatrzymane STOP otrzymują stan `cancelled`, odróżniony od pauzy; nie są wznawiane automatycznie. Rozpoczęte skutki nie są cofane. W bazie pozostają dowody albo stan wymagający sprawdzenia.

## Wyniki i granice

[results60.json](results60.json) i [RESULTS_60.md](RESULTS_60.md) obejmują 60 wymagań. NOT_RUN oznacza niewykonany zakres, BLOCKED konkretny brak środowiska. Osobno zapisano czerwone reprodukcje i zielone testy warstwy adaptera/UI. Żadnego wyniku fixture nie uznano za dowód działania prawdziwego modelu.

W trzech próbach UI STOP został przyjęty w 27–58 ms (końcowe powtórzenie; początkowo 54–108 ms), transport anulowano, nie pojawiła się zakazana notatka. Sprawdzono też nową lokalną komendę po STOP. To pomiar tej sesji, nie gwarancja na komputerze użytkownika.

Pozostałe luki: brak pełnego sterowania GUI użytkownika i Wayland; brak propagacji STOP do wszystkich zewnętrznych MCP, odłączonych potomków procesu oraz inference workera WebLLM; trwająca akcja zewnętrzna może mieć nieznany skutek. Wyłącznie własne bezpośrednie procesy workspace objęto testem zakończenia. Nadal brakuje zakresowych zgód per zasób, interaktywnego browser agenta, zweryfikowanego sandboxa generowanych narzędzi, pełnej selekcji i diagnostyki modeli, rzeczywistej zmiany tempa i wszystkich 60 przebiegów. Nie dodano globalnego allow-all ani nie wyłączono sandboxa.

SECURITY.md zawiera historyczne wymagania rotacji; nie odczytywano sekretów i nie deklaruje się ich rotacji.

## Uruchomienie i wycofanie

W tej kopii ze źródeł: `npm run build`, potem `npm run electron:dev` w działającej sesji graficznej. Build ze źródeł nie aktualizuje zainstalowanego .deb/AppImage. Nie uruchamiać aplikacji jako root ani z `--no-sandbox`.

Powtarzanie testu UI: uruchomić Vite na 5192 z testowym `JARVIS_LICENSE_REQUIRED=false`, następnie `node QA/autonomia60/evidence/stop-ui.cjs` przy dostępnych Playwright i `/usr/bin/chromium`. Skrypt blokuje sieć zewnętrzną i używa świeżych profili. Nie kopiować konfiguracji testowej do wydania.

Poprawki są lokalne i nie zostały opublikowane. Plik `implementation.patch` (gdy obecny) zawiera zmiany kodu/testów względem zapisanej bazy, bez danych użytkownika. Przed wycofaniem należy użyć `git apply --check --reverse QA/autonomia60/implementation.patch`; dopiero poprawny check pozwala wykonać `git apply --reverse QA/autonomia60/implementation.patch`. Przy konflikcie nie stosować reset/clean, tylko wycofać odpowiednie fragmenty ręcznie. Raport i dowody pozostają do porównania.

## Końcowa walidacja etapu

- Pełna regresja: **2888 PASS, 2 FAIL**, 350 plików testów. Pozostałe dwa błędy dotyczą wcześniej istniejących testów licencji.
- Po ostatnich barierach adapterów: **117/117** testów dostawców/streamingu oraz **14/14** końcowych testów STOP/możliwości/portu przeszło.
- STOP przez normalny kanał UI: dwa przebiegi po trzy próby, ostatni 27–58 ms przyjęcia, zero późnych notatek; kontrolowany protokół zastępuje model, nie ukryto tego jako prawdziwego LLM.
- Build zawiera kontrolę TypeScript. Wyniki końcowego build/lint zapisano osobno w validation-summary.json.
- Adnotacja `release-desktop/**` w ESLint wyklucza tylko wygenerowane artefakty pakietu; reguły dla źródeł pozostają aktywne.
