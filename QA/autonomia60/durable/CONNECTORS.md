# changedetection.io / ntfy / kalendarz w istniejącym wykonawcy

Stan: implementacja + kontrolowane testy kontraktów. To nie jest dowód działania skonfigurowanej usługi produkcyjnej ani autonomii rzeczywistego modelu. Kod bazowy sesji: `fb17f9755faad72295cb125563ba2b0220d9319d`; poniższe zmiany są nakładką roboczą tej kontynuacji, a ostateczny commit opisuje wspólny raport wydania.

## Zakres i źródła

| Rozwiązanie | Decyzja / wkład | Zweryfikowana dokumentacja / licencja | Koszt i dostęp |
| --- | --- | --- | --- |
| changedetection.io | INTEGRATED: odczyt metadanych istniejącego watch oraz `history/latest`; snapshot nie tworzy oferty ani nie potwierdza ceny/dostawy | [API Watch.py, commit cdb6fc6b0d340fd28c003474918385c4b8290be0](https://github.com/dgtlmoon/changedetection.io/blob/cdb6fc6b0d340fd28c003474918385c4b8290be0/changedetectionio/api/Watch.py), wersja źródła 0.70.1, [Apache-2.0](https://github.com/dgtlmoon/changedetection.io/blob/cdb6fc6b0d340fd28c003474918385c4b8290be0/LICENSE) | Wymagana własna działająca usługa lub świadomie wybrany hosting; JARVIS nie instaluje serwera i nie kupuje usługi. |
| ntfy | INTEGRATED: JSON POST do zatwierdzonego serwera i tematu, sprawdzenie odpowiedzi dostawcy | [publishing, commit 59f9931f0f365f1e33871ed9d641b33e8039c190](https://github.com/binwiederhier/ntfy/blob/59f9931f0f365f1e33871ed9d641b33e8039c190/docs/publish.md), [Apache-2.0](https://github.com/binwiederhier/ntfy/blob/59f9931f0f365f1e33871ed9d641b33e8039c190/LICENSE) | Własny serwer lub wybrany hosting, jego limity i taryfa; brak domyślnego publicznego tematu, rejestracji i płatności. |

Nie skopiowano ani nie uruchomiono kodu upstream. Pin dokumentacji nie oznacza wykrycia wersji serwera użytkownika.

## Użycie

W istniejącym panelu **Cele → Monitoring i powiadomienia → Połączenia changedetection.io i ntfy** podaj nazwę, adres bazowy działającej usługi oraz opcjonalny token. Dla ntfy podaj dokładny temat i potwierdź możliwość ujawnienia tytułu, linku, kosztu oraz identyfikatorów alertu. Sam token nie dowodzi prywatnego ACL tematu. Konfiguracja wymaga potwierdzenia w oknie natywnym, które pokazuje adres i zakres. Nowa konfiguracja zawsze ma nowe ID; stara zgoda nie przechodzi automatycznie na nowy kanał.

Publiczne usługi wymagają HTTPS. Osobna jawna zgoda dopuszcza tylko `localhost` i literalne adresy loopback; nie przyznaje dostępu do całego LAN. DNS jest sprawdzany i przypinany do pojedynczego połączenia. Przekierowania nie są wykonywane. W adresie bazowym nie wolno umieszczać hasła, parametrów zapytania ani fragmentu.

Token i temat są zapisywane w `monitor-connectors.enc` przez Electron safeStorage, atomowo, z prawami 0600; brak bezpiecznego backendu lub `basic_text` blokuje konfigurację. Lista połączeń nie zawiera tokenu ani tematu. Model nie ma narzędzia do konfiguracji lub rozszerzania zgód. Usunięcie konfiguracji uniemożliwia następny odczyt/wysyłkę. Nie usuwa już wysłanej wiadomości z obcej usługi.

Utwórz monitor, wybierz połączenie changedetection i UUID istniejącego watch. Wymagany tekst sprawdzany jest w tytule i snapshotcie, `*` oznacza każdą zmianę. Pierwszy odczyt daje `BASELINE_RECORDED`, powtórzony bez zmian `NO_CHANGE`; dopiero następna zmiana pasująca do kryteriów tworzy zdarzenie. Czas odczytu JARVIS-a i `last_checked` źródła są pokazane oddzielnie. Wybierz centrum zdarzeń, powiadomienia desktopowe albo konkretne połączenie ntfy. Zgoda na źródło oraz kanał jest zakresowa. Nie istnieje adapter ogólnego rynku Allegro.

`ACCEPTED` wymaga odpowiedzi ntfy `event=message`, ID i zgodnego tematu. Nie oznacza doręczenia ani przeczytania. Zdarzenie jest zapisywane przed wysłaniem. HTTP 429 pozwala na ograniczone ponowienie z Retry-After, maksymalnie pięć prób; jawne odrzucenie 400/401/403/404/413 blokuje alert. Timeout, utrata połączenia, 5xx lub niepoprawny ACK pozostają `UNCERTAIN`, bez automatycznego ponownego wysłania. API ntfy nie daje tu gwarancji idempotentnego POST; identyfikator zdarzenia jest w wiadomości do ręcznego uzgodnienia. STOP przerywa aktywne żądanie i przyszłe sprawdzenia, lecz skutek wcześniej rozpoczętego POST może pozostać nieznany.

Kalendarz daily/weekly/monthly działa w tym samym `goal-service.cjs`. Stare interwały i zgody pozostają zgodne. Kalendarz zaczyna od następnego terminu, interwał od razu. Europe/Warsaw: nieistniejąca godzina przy przejściu na czas letni i nieistniejący dzień miesiąca są pomijane; powtórzona godzina przy przejściu na czas zimowy wykonuje się przy pierwszym wystąpieniu. Po restarcie/uśpieniu jest jedno zaległe sprawdzenie, a następne w przyszłości. Po błędzie źródła działa istniejący ograniczony backoff i budżet dobowy. To harmonogram odczytów monitorów, nie nowy wykonawca dowolnych cyklicznych poleceń.

## Dowody

Polecenie: `npx vitest run tests/goalService.test.ts tests/monitorConnectors.test.ts tests/monitorSchedule.test.ts tests/monitorPanel.test.ts --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=QA/autonomia60/durable/connector-tests.json`.

- `monitorConnectors`: 12 kontrolowanych testów; rzeczywisty serwer HTTP na losowym porcie loopback, rzeczywisty transport adaptera, AES-GCM w tymczasowym magazynie zamiast niedostępnego natywnego safeStorage. Sprawdza zgodę właściciela, osobny zakres lokalny, ujawnienie tematu, brak sekretów w liście i pliku stanu; odczyt dokładnego watch, bazę/zmianę/restart; ACK i brak fałszywego delivery; odwołanie konfiguracji/zgody, usunięcie podczas GET/POST i odrzucenie wyniku przed zapisem; 429; zerwane połączenie; STOP podczas rzeczywistego POST; redirect; prywatny DNS oraz przypięte połączenie lokalne.
- `monitorSchedule`: 4 testy obliczeń IANA i trwałego magazynu: wiosenna luka, jesienna powtórzona godzina, dzień 31 i walidacja, restart/catch-up/STOP bez zastąpienia starych zgód.
- `monitorPanel`: 2 testy React/IPC: rzeczywiste obiekty stanu i potwierdzenie odczytu w magazynie; formularz przekazuje dokładne ID changedetection/ntfy i czyści pole tokenu. IPC konfiguracji w drugim teście jest kontrolowane; nie jest to natywne zatwierdzenie użytkownika.
- `goalService`: 20 istniejących testów regresji, w tym osobne procesy, wygasanie lease, SIGKILL, brak późnych skutków, limity i niepewne powiadomienia.
- `node --check` obu plików CJS, `git diff --check` oraz `npx tsc -b --pretty false`: PASS podczas pracy nad tym zakresem. Pełny build i końcowy zestaw sprawdza raport zbiorczy.

## Niepotwierdzone części

BLOCKED: rzeczywisty skonfigurowany changedetection, rzeczywisty prywatny temat ntfy i jego dostarczenie do urządzenia — w tej sesji nie udostępniono autoryzowanych adresów/poświadczeń. Nie wysłano nic do publicznego tematu. BLOCKED: natywny magazyn kluczy, natywne dialogi i klikanie tego panelu w docelowej sesji Electron; kontrolowane testy UI nie zastępują tego dowodu. Brak dowodu normalnego polecenia do rzeczywistego modelu, który sam wybiera te narzędzia. Nie przyznajemy zaliczenia całemu scenariuszowi autonomii na podstawie tych testów.
