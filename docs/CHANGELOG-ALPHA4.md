# JARVIS 2.1.0-alpha.4

Eksperymentalna kontynuacja alpha.3. Naprawiono podmianę katalogów i plików podczas odczytu umiejętności: deskryptory katalogów pozostają otwarte, a ponownie otwarte elementy są porównywane z ich tożsamością. Limit to 255 podkatalogów. STOP i izolacja pozostają aktywne.

Kontrolowana próba przez pole rozmowy wykonuje cykl wyszukania, inspekcji, testu, aktywacji i użycia skilla, następnie JARVIS zapisuje i odczytuje plik, który sprawdzono niezależnie. Kandydat pochodził z wcześniej zeskanowanego lokalnego katalogu. Model i transport są kontrolowanymi komponentami testowymi; próba nie potwierdza samodzielnego rozpoznania brakującej zdolności, pobrania nowego skilla, autonomii rzeczywistego modelu ani natywnego IPC Electron.

Wyszukiwanie nowych serwerów MCP i tworzenie nowego watcha changedetection na podstawie polecenia nadal wymagają implementacji. Istniejący klient MCP i adapter istniejącego watcha nie spełniają tych wymagań. Rzeczywista Ollama, zewnętrzne usługi oraz pulpit użytkownika nie były dostępne do odbioru. Wcześniejsze losowe błędy uruchomienia przeglądarki w CI mają nieustaloną przyczynę.

Instalacja i wycofanie: WYDANIE-ALPHA.md. Szczegóły testów i ograniczeń: REPORT.md oraz requirements.json.
