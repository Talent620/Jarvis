# Dobór narzędzi i diagnostyka Ollamy

Baza tej iteracji: f74705166e484f9fe76a9ecac7212a45376254ba. Zmiany w istniejących modułach, bez nowego wykonawcy.

## Zaimplementowane

- `providers/ollama.ts`: jawna próba protokołu tool calling (`probeOllamaTools`). Odczytuje /api/tags, /api/ps, /api/show z skonfigurowanego adresu, następnie wymaga pojedynczego wywołania izolowanego echo z losowym argumentem. Nigdy nie wykonuje rzeczywistych narzędzi. Powitanie, nazwa modelu lub sama deklaracja `tools` nie przechodzą próby. Osobne installed (null przy braku wiedzy), loadedBeforeProbe przed próbą, advertised, wynik tools, czas i termin ważności. Cache per endpoint+model: 10 minut dla sukcesu, 30 sekund dla braku potwierdzenia; limit 64 wpisów. STOP nie zapisuje negatywnego dowodu.
- Istniejąca akcja ustawień „dobierz z zainstalowanych” korzysta z tej próby, kolejno dla maksymalnie sześciu modeli. Wybiera wyłącznie potwierdzone narzędzia; szybki wybór opiera o czas tej małej próby, nie ocenę inteligencji. Nie przełącza ustawień bez potwierdzenia. Nie pobiera modeli i nie rozgrzewa dodatkowo. Funkcja nie zmienia istniejącej decyzji o prewarm; usuwa dodatkowe warmNow z tego przycisku. Widok podaje, że wizja jest deklaracją metadanych, nie testem jakości obrazu.
- `toolSelector.ts`: ogranicza liczbę i rozmiar całych schematów także dla nieznanych pluginów. Łączy grupy domen i trafność nazw/opisów; nie interpretuje opisów jako instrukcji. Niejasne polecenie nie przesyła całego katalogu. Dodano wspólne grupy plików/monitorów oraz komplet dostępnych operacji okien/schowka.
- `brain.ts`: wylicza budżet schematów dla wybranej lokalnej Ollamy z rzeczywistego system promptu i bieżącej wiadomości. Adapter zachowuje bieżącą turę i wyniki narzędzi, usuwa stare pełne tury, a gdy pozostały prompt nadal przekracza szacowany budżet, odmawia przed HTTP. Nie obcina polecenia i nie próbuje rozgrzewania jako naprawy przepełnienia. Estymacja UTF-8 to przybliżenie, nie tokenizer danego modelu.
- Uszkodzony JSON argumentów modelu nie jest zamieniany na pusty obiekt uruchamiany przez narzędzie. Akcja bez dobranych narzędzi nie degraduje do tekstowego wywołania modelu.

## Dowody i granice

`evidence/model-capabilities-tests.log`: testy unit/integracji adaptera z kontrolowanym HTTP, nie z rzeczywistą Ollamą. `tests/toolSelectionComposition.test.ts` sprawdza 12 różnych parafraz i połączeń domen z prawdziwym katalogiem definicji narzędzi. To jeden test pętli retrieval, nie 12 zaliczeń rzeczywistego planowania LLM. Oddzielnie testuje zalew pluginów i budżet.

Brak dostępnego modelu/sesji nie jest podstawą niewykonania tych niezależnych testów. Nie zaliczono rzeczywistej generalizacji, widzenia, kodowania, embeddingów ani głosu. Pełne osobne próby funkcjonalne tych modalności pozostają MISSING_IMPLEMENTATION; narzędzia mają protokół kontrolowany PASS, rzeczywisty endpoint/model pozostaje do testu lokalnego. Ranking po jednej małej próbie nie dowodzi niezawodności ani przewagi modelu. latencyMs obejmuje również odczyty metadanych HTTP i możliwe ładowanie modelu; nie jest benchmarkiem sprzętu ani tokens/s. Cache jest pamięcią procesu, nie trwałym benchmarkiem; restart wymaga nowej próby.

Granica selekcji: ranking jest heurystyką, może nie wybrać potrzebnego narzędzia dla niejasnego celu. Nie zaimplementowano modelowego discovery całego katalogu. Native adapter nie wykonuje wywołań spoza udostępnionego zestawu; ograniczenie nie daje pluginowi nowych zgód. Przepełniony sam kontekst systemowy wymaga ograniczenia danych przez użytkownika, nie jest automatycznie streszczany kosztem instrukcji.
