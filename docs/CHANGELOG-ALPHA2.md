# JARVIS 2.1.0-alpha.2

Wydanie eksperymentalne. Nie ma jeszcze pełnego odbioru rzeczywistego modelu, pulpitu i wszystkich funkcji.

- Naprawiono Debian `chrome-sandbox`: weryfikacja pliku i chronionych katalogów przed ustawieniem `root:root 4755`.
- Dodano natywny katalog Agent Skills: inspekcja, kwarantanna, test, polityka właściciela, przypięte wersje, aktualizacja, rollback i odwołanie.
- Kod Node.js umiejętności działa w rzeczywistej izolacji Linux bubblewrap/seccomp. Generowane narzędzia przechodzą ten sam cykl życia.
- Dodano przeglądarkę Playwright z odrębnym profilem, zakresami serwisów, ochroną szkiców, zatwierdzaniem wysyłki i bezpiecznym pobieraniem na Linux.
- Rozszerzono STOP i odwołanie dostępu w umiejętnościach, przeglądarce, MCP oraz monitorach.
- Naprawiono przejmowanie zgody formularza przez żądania szkicu oraz przekierowania poza zakres. Odmowa i niepewny skutek wysyłki mają osobne wyniki; SPA/iframe pozostają jawnie ograniczone.
- Dodano changedetection.io i ntfy do istniejącego monitora oraz harmonogramy kalendarzowe Europe/Warsaw.
- Zintegrowano kontrolki w istniejących Ustawieniach i Celach. Usunięto mylące procenty gotowości i niezmierzone oszczędności czasu.
- Zachowano wcześniejsze komendy lokalne, wyniki częściowe, zapis/odtwarzanie celów, oba interfejsy oraz licencje właściciela.

Końcowa regresja: 3089 testów PASS, lint PASS; build produkcyjny przeszedł i jest ponawiany z czystego commitu przed publikacją. Osobny licencjonowany test przez pole rozmowy użył kontrolowanych decyzji dostawcy, rzeczywistego sandboxa i niezależnego odczytu pliku. Nie zalicza on autonomii prawdziwego modelu.

Wymagania i ograniczenia: istniejące Chromium; dla kodu umiejętności Linux x86_64, Node, bubblewrap i prlimit; konfiguracja i zgody dla usług zewnętrznych. Rzeczywista Ollama i pulpit nie były dostępne w tej chmurze. Pełny audit npm nadal ma 32 zgłoszenia, w tym Electron dystrybuowany w aplikacji. Zmiana głównej wersji runtime pozostaje otwarta.

Instalacja, licencje, migracja i wycofanie: `WYDANIE-ALPHA.md`. Używanie i konfiguracja: `UMIEJETNOSCI-INTEGRACJE.md`. Szczegółowy odbiór: `REPORT.md` i `requirements.json` dołączone do wydania.
