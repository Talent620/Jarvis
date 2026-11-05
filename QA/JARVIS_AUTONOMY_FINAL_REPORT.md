# JARVIS — raport autonomii

Ten raport opisuje wyniki konkretnej partii sprawdzeń, a nie deklarację ukończenia wszystkich funkcji. Szczegółowy rejestr 50 scenariuszy: [JARVIS_AUTONOMY_50_TESTS.md](JARVIS_AUTONOMY_50_TESTS.md). Aktualizacja raportu po kolejnych rzeczywistych testach jest konieczna.

## Wyniki testów

- **Kontrole modułów:** 63 testy z 10 plików Vitest przeszły. [Zapis wyniku](evidence/vitest-autonomy.txt).
- **Dodatkowe kontrole zespołu:** Vite odpowiedział HTTP 200 dla strony głównej i modułu wejściowego; smoke Site OS przeszedł na izolowanych danych. `linuxLaunch.test.ts`: 3/3, w tym rzeczywiste uruchomienie `/usr/bin/true`, brakujący program i blokada składni shella.
- **50 scenariuszy end-to-end:** brak w tej partii dowodów pełnego wykonania, więc 50 pozycji ma status BLOCKED. Wynik testu jednostkowego nie jest dowodem wykonania odpowiadającej mu czynności w aplikacji.
- **Pełny zestaw podczas prac:** 2822 testy przeszły, 2 testy licencji zawiodły (`tests/license.test.ts`); znany problem z danymi testowymi/weryfikacją licencji. Ten przebieg trwał podczas dalszej edycji. Końcowy zestaw dotyczący zmienionych ścieżek: 76/76 przeszło.
- **Ponowne testy i naprawy:** dla 50 scenariuszy nie zostały tu przeprowadzone; dalsze wyniki powinny być dodane po ich wykonaniu.

## Architektura i autonomia komputerowa

Aplikacja używa procesu Electron (`electron/main.cjs`, `electron/preload.cjs`) oraz interfejsu React (`src/App.tsx`). Istnieje warstwa narzędzi (`src/lib/tools.ts`), planowania i wykonywania agentów (`src/lib/agentPlan.ts`, `agentPlanner.ts`, `agentPipeline.ts`, `agentRun.ts`), obsługa stanów i wznawiania celów (`src/lib/goalState.ts`, `goalRuntime.ts`, `goalResume.ts`), routing (`src/lib/modelRouter.ts`) oraz adapter Ollamy (`src/lib/providers/ollama.ts`). Są też mechanizmy zgód (`src/lib/permissions.ts`) i panel ustawień prywatności. Obecność modułów nie dowodzi prawidłowego działania z systemem użytkownika.

Electron zawiera interfejs przechwytywania ekranu i schowka oraz uruchamiania programów. W bieżącej powłoce `XDG_SESSION_TYPE` jest nieustalony, a `DISPLAY` i `WAYLAND_DISPLAY` nie są ustawione; nie ustalono więc X11 ani Waylanda na komputerze użytkownika i nie potwierdzono prawdziwego działania tych operacji. Stan procesów i funkcji może różnić się w innym środowisku.

## Przeglądarka, oferty i wiadomości

W tej partii nie uruchomiono agenta na stronie, nie porównano rzeczywistych ofert i nie wypełniono kontrolowanego formularza. Wynik testów `research.test.ts` jest częściowym testem kodu i nie dowodzi możliwości obsługi autoryzowanej przeglądarki lub aktualności cen. Nie wysyłano wiadomości.

## Wytrwałość i modele

Przeszły testy modułów wznowienia i routingu. Nie sprawdzono wznowienia prawdziwego zadania po restarcie aplikacji, zapobiegania powtórnej wysyłce ani rzeczywistego wyboru modelu. CLI `ollama` nie jest dostępne w badanej powłoce, a lokalny endpoint nie odpowiedział; zapytania do modelu i błędu limitu kontekstu nie zweryfikowano.

## UX

Test komponentu wyboru interfejsu przeszedł. Nie wykonano pełnej kontroli wizualnej, dostępności ani responsywności aplikacji Electron.

## Dokumenty i dowody

- `QA/JARVIS_AUTONOMY_50_TESTS.md` — lista scenariuszy i stan wykonania tej partii.
- `QA/evidence/vitest-autonomy.txt` — wynik uruchomionych testów modułów.
- `QA/JARVIS_AUTONOMY_FINAL_REPORT.md` — niniejsze zestawienie.

## Wdrożone zmiany

- `electron/local-ollama.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `src/lib/desktop.ts`, `src/App.tsx`: start skonfigurowanej lokalnej Ollamy na domyślnym porcie po sprawdzeniu gotowości; bez pobierania modeli. Test wykorzystuje rzeczywisty lokalny proces atrapy, nie prawdziwą Ollamę.
- `electron/launch-app.cjs`, `src/lib/tools.ts`: mapowanie aplikacji Linux i weryfikacja startu procesu; nie weryfikuje otwartego okna.
- `src/lib/providers/ollama.ts`, `src/lib/toolSelector.ts`, `src/lib/brain.ts`: szacowanie kontekstu, usuwanie starszych tur i mniej narzędzi dla powitań; limit nie jest gwarantowany, szczególnie dla obrazów.
- `src/lib/agentRun.ts`, `src/lib/actionOutcome.ts`, `src/lib/goalControl.ts`, `src/lib/goalRuntime.ts`, `src/lib/goalState.ts`, `src/components/GoalStatusPanel.tsx`: uczciwe statusy, pauza między krokami, blokada równoległego uruchomienia i zatrzymanie przy błędzie zapisu stanu. Niepewne wyniki wymagają sprawdzenia.
- `tests/agentPipeline.test.ts`, `tests/agentRun.test.ts`, `tests/goalRuntime.test.ts`, `tests/goalControl.test.ts`, `tests/linuxLaunch.test.ts`, `tests/localOllamaStart.test.ts`, `tests/ollamaChatPath.test.ts`, `tests/ollamaContext.test.ts`: testy zmian. Końcowy przebieg 13 plików: 76/76 testów przeszło.

Test Chromium z włączonym sandboxem, izolowanym profilem i bez dostępu do sieci potwierdził przełączanie wyglądu, komendy, odtworzenie rozmowy po ponownym uruchomieniu oraz przełącznik w ustawieniach. Nie było rzeczywistej sesji pulpitu X11/Wayland ani modelu Ollama.

## Dalsze kroki

Pauza nie przerywa trwającego I/O. Przed akcją zapisywany jest checkpoint próby i w razie awarii nie następuje automatyczne ponowienie. Brakuje blokady między odrębnymi instancjami oraz uniwersalnej idempotencji dostawcy. Potrzebne są rzeczywiste testy desktopowe w izolowanej sesji oraz testy dostępnej Ollamy/modelu, w tym limitu kontekstu i obrazu. Należy następnie wykonać zadania, strony i formularze testowe, zebrać dowody oraz osobno potwierdzić zachowanie uprawnień, wznowienia i niepowtarzania czynności zewnętrznych. Scenariusz porównania ofert wymaga rzeczywiście dostępnych źródeł i weryfikacji informacji na stronach; nie należy deklarować niezaobserwowanych cen ani dostępności.

## Dodatkowe wdrożenia

- `electron/local-siteos.cjs` uruchamia po wcześniejszym sparowaniu lokalny Site OS bez otwierania przeglądarki i bez tunelu; test używa rzeczywistego serwera na izolowanym porcie i danych.
- `electron/linux-keyboard.cjs` oferuje ograniczone akcje w X11 po weryfikacji okna i zgodzie. Wayland, polskie znaki i fizyczna sesja nie zostały zweryfikowane; dialog zgody może przejąć fokus.
- `electron/public-page.cjs`, `electron/page-extract.cjs` i `src/lib/systemMcp.ts` czytają publiczną stronę bez logowania, cookies i skryptów, z ograniczeniami sieci. Test obejmuje kontrolowaną stronę, nie interaktywną przeglądarkę. Niezaufany tekst może zawierać instrukcje i jego oznaczenie nie jest kompletną ochroną przed prompt injection.
- `src/lib/permissions.ts`, `src/components/ConsentManager.tsx`, `src/components/PermissionDialog.tsx` i `src/components/Settings.tsx` dają wgląd w zgody i wymagają pojedynczej decyzji dla nieodwracalnych działań.
- `src/lib/goalProgress.ts` i `src/components/GoalStatusPanel.tsx` pokazują zapisane wyniki. Polecenie „pospiesz się” pokazuje postęp, nie zmienia tempa.
- Wykonanie wygenerowanego kodu jest zablokowane do czasu dostępności zweryfikowanego sandboxa; terminal nie jest izolowany.
- Dostawca lokalny nie przechodzi automatycznie na chmurę; dla obrazu adapter Ollamy wymaga potwierdzonej możliwości vision.

## Końcowe kontrole etapu

- Build i TypeScript przeszły; lint przeszedł.
- Pełny przebieg z 5 listopada: 2871 testów przeszło, 4 zawiodły. Dwa błędy `tools.test.ts` dotyczyły zmienionych wymagań zgody; po dodaniu jawnej zgody testowej ponowiono `tools.test.ts` i testy uprawnień: 258/258 przeszło. Dwa testy `license.test.ts` nadal zawodzą; nie zmieniano klucza ani nie wyłączano weryfikacji.
- `ubuntu:check` przeszedł; Docker daemon był niedostępny. Wydanie linuxowe sprawdzano osobno przez electron-builder.
- Scenariusze pełnej autonomii nie są ukończone. Prawdziwej Ollamy, sesji X11/Wayland i interaktywnej zalogowanej przeglądarki nie było w tym środowisku.
