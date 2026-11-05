# Stan wznowienia — autonomia i licencje APK

**Bieżące przekazanie qa:desktop:** poprzedni HEAD `155a2e146bab33239951c1a7ae5ad8a1b043f6f9`. Po sprawdzeniu kodu i pakietu użytkownik jawnie autoryzował commit i push ośmiu plików na osobną gałąź `codex/qa-desktop-handoff-20261105`. Nowe poprawki tylko w istniejących helperach QA, ich dokumentacji i teście konfiguracji; kod produktu STOP, komend, wyników, nagłówka i trwałości pozostaje bez zmian. `qa:desktop` łączy niezależne licencjonowane testy komend/ustawień/restartu z dotychczasowymi scenariuszami realnego modelu; `qa:agent:real` jest aliasem. Główne A/B/C mają osobny wynik i nie mogą zostać zaliczone samym startem runnera. Nie instalować ani nie uruchamiać Xvfb. Brak modelu nie pomija testów niezależnych. Zgoda obejmuje tę osobną gałąź QA; nie obejmuje merge do main ani publikacji wydania. Pakiet przekazania zawiera patche od b3234ca i 155a2e1, manifest wszystkich zmian i instrukcję, bez profili, prywatnych kluczy i node_modules. Dopóki użytkownik nie uruchomi na swoim komputerze, nie deklarować lokalnego testu jego pulpitu/modelu. C pozostaje także luką implementacji pełnego schowka/fokusu/orakla.

**Najnowsza iteracja — licencje APK:** czytaj `license-iteration/REPORT.md` i `docs/LICENCJE-APK.md`. Poprzednie zmiany zachowane w `0320d50`; bieżąca gałąź `codex/apk-license-qa-20261105`. Użytkownik teraz autoryzował push kodu na GitHub i wybrał generowanie własnej pary lokalnie podczas instalacji (prywatna część na jego komputerze). Nie autoryzował instalacji Xvfb, merge do main ani publikacji wydania. Naprawiono dwa testy: próbka była podpisana poprzednią parą; obecny publiczny punkt jest poprawny i pozostał bez zmian. Wcześniejszy pomocniczy regex błędnie odczytywał `y` z `kty` — diagnozę sprostowano. Testy: 2908 PASS / 0 FAIL, lint/build PASS. Realny UI wydania→aktywacji z wymaganą licencją PASS B. `qa:agent:real` dodany dla A–C; tutaj BLOCKED na obu lokalnych API. D NOT_RUN, pełna obsługa schowka nadal brakująca. Stan push potwierdzić `git log` i zdalną gałęzią; sama notatka nie potwierdza publikacji. Nie deklarować instalacji użytkownika ani gotowego natywnego APK — tutaj brakuje SDK.

**Aktualizacja kontynuacji QA 2026-11-05:** najpierw czytać `continuation/REPORT.md` i `continuation/results.json`. Nowe runnery `npm run qa:preflight`, `qa:agent:smoke`, `qa:desktop` zostały uruchomione. D1 rzeczywista komenda lokalna przez UI + restart procesu Chromium: PASS B. S1 BLOCKED (oba porty 11435 i 11434 ECONNREFUSED), S2–S8 NOT_RUN; nie awansować D1 do ich zaliczenia. Electron i alternatywne próby headless nie uruchamiają renderera. Użytkownik odpowiedział: **bez instalacji — sprawdzę Electron lokalnie**. Nie instalować Xvfb. Brak push/publikacji/instalacji systemowej. Nowy przyrostowy `continuation/iteration.patch` ma zweryfikowane odwrotne zastosowanie i zachowuje wcześniejszą pracę. Pełny zestaw po zmianach: 2901 PASS / 2 znane FAIL licencji; lint/build PASS. Dalsza praca: lokalny `qa:desktop`, prawdziwy model i D2, następnie implementacja/orakle S2–S8, szczegóły G1–G5 w results.json.

Baza: `work` na `b3234ca906305712ade35363cffc3524c9a1b21a`. Zmiany kodu i testy są niezacommitowane. Nie wykonywać reset, clean ani stash; zachować tę pracę. Nie wykonywać push, publikacji ani instalacji systemowej bez nowego upoważnienia dla tego etapu.

## Ukończony zakres

1. STOP jako osobny kanał, sygnał do adapterów i transportu, bariera przed nowymi narzędziami i po zgodzie. Lokalna komenda „stop” przy busy; stały przycisk.
2. Stan cancelled dla celu zatrzymanego STOP, rozróżniony od pauzy. Blokada automatycznego wznowienia cancelled.
3. Zaufany IPC do zatrzymania bezpośrednich własnych procesów narzędzi workspace; test rzeczywistego procesu Node.
4. Nieznane nowe narzędzia nie dziedziczą automatycznej/wildcard zgody. Nazwany zakres nadal działa.
5. Zadanie wymagające narzędzi nie degraduje po błędzie braku tool calling do samego tekstu. Adaptery blokują wywołania spoza zestawu udostępnionego modelowi.
6. Produkcyjny autostart odczytuje jawny lokalny port Ollamy zamiast zakładać 11434.
7. Raport 60 scenariuszy, reprodukcje przed/po, dowody częściowego UI, instrukcja uruchomienia i wycofania.

## Otwarte bramki

- Realna sesja X11/Wayland i konfiguracja użytkownika nie są dostępne. Nie naprawiać braku dostępu przez `--no-sandbox`, root lub zmianę systemowej polityki.
- Prawdziwa Ollama na endpointcie użytkownika i modele nie są dostępne. Sprawdzony w tej maszynie 11435 odmawia połączenia; nie utożsamiać tego z jego urządzeniem.
- Pełna propagacja STOP do WebLLM workera, obcych MCP i odłączonych potomków procesów nadal wymaga pracy. Rozpoczęte efekty pozostają do uzgodnienia, nie gwarantować cofnięcia.
- Następny krok implementacyjny: zakresowe uprawnienia i wiarygodny wybór/fokus okna, test normalnego polecenia kopiuj/wklej/zapisz na docelowym pulpicie. Potem selekcja/odkrywanie narzędzi i budżet promptu; niejasna intencja nadal wysyła pełny zestaw.
- Wymagania researchu, rankingu ofert, sandboxa narzędzi, zmiany tempa i audytu wszystkich ekranów nie są ukończone. Szczegóły w `results60.json`; nie zmieniać BLOCKED/NOT_RUN na PASS bez niezależnych dowodów.
- Dwa znane bazowe testy licencji zawodzą. Nie osłabiać weryfikacji ani nie podmieniać klucza na potrzeby przejścia testów.

## Powtórzenie kontroli

`npm test`, `npm run build`, `npm run lint`. Dowody bazowej awarii STOP i zielone regresje są w evidence/. Test UI: testowy Vite na 5192, `node QA/autonomia60/evidence/stop-ui.cjs`, Chromium sandbox ON, trzy niezależne profile, kontrolowany protokół zamiast LLM. Nie przedstawiać go jako autonomii rzeczywistego modelu.
