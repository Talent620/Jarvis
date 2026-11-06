# JARVIS 2.1.0-alpha.6 — eksperymentalne, niepełne prerelease

Dodano wyszukiwanie kandydatów w oficjalnym rejestrze MCP po pokazaniu zapytania i uzyskaniu natywnej zgody właściciela. Wyniki są niezaufanymi metadanymi; funkcja nie instaluje ani nie uruchamia serwerów. Dostęp do rzeczywistego rejestru był zablokowany polityką sieci środowiska, testy przeprowadzono na kontrolowanej usłudze.

Dodano tworzenie watcha changedetection na skonfigurowanym serwerze, z natywną zgodą na konkretny adres i niezależnym odczytem konfiguracji. Watch jest tworzony **w pauzie i z wyciszonymi powiadomieniami**: nie monitoruje jeszcze strony. Zapis zamiaru i stan niepewny po STOP chronią przed automatycznym ponowieniem operacji o nieznanym skutku. Wznowienie, powiadomienia, usunięcie oraz powiązanie całego cyklu życia nowego watcha z zadaniem nie zostały ukończone. Nie testowano rzeczywistego serwera.

Nie zaliczono pełnego cyklu autonomicznego pozyskania nieznanej umiejętności lub MCP przez prawdziwy model. Ollama i sesja pulpitu użytkownika były niedostępne. Kontrolowany test skilla używa syntetycznych decyzji i wcześniej zeskanowanego lokalnego katalogu. Nierozwiązane pozostają wcześniejsze sporadyczne błędy uruchomienia przeglądarki w CI, zależności Electron oraz brak podpisanego wydania Android. Nie twierdzimy, że JARVIS został zainstalowany lub sprawdzony na komputerze właściciela.

Poprawiono wyścig, w którym kliknięcie mogło zostać zgłoszone przed przechwyceniem żądania SPA. Po kliknięciu oczekujemy na uspokojenie ruchu, z limitem; po jego przekroczeniu wynik pozostaje niepotwierdzony. Nie stanowi to gwarancji dla dowolnie opóźnionych działań strony. Nieudany workflow taga alpha.5 ujawnił tę regresję i nie opublikował wydania.

Instalacja, własny klucz licencji i wycofanie: WYDANIE-ALPHA.md. Historyczne dowody alpha.4 i ograniczenia: REPORT.md i requirements.json.
