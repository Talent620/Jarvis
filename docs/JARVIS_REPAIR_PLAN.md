# Plan napraw i rozwoju JARVIS

Plan jest iteracyjny. Każdy punkt ma własny zakres, test i mały commit. Funkcje nie będą usuwane
bez potwierdzenia.

## KRYTYCZNE

### K1. Przywrócić zielone testy głównej aplikacji

Status: **wykonane**
Commit: `c3a409b`

- jawnie sklasyfikować ryzyko lokalnego agenta badawczego;
- uodpornić obsługę błędów natywnej Ollamy;
- dostosować testy do natywnego kontraktu `/api/chat`.

Warunek odbioru: testy regresji i build przechodzą.

### K2. Ustabilizować narzędzia jakości na Windows i Ubuntu

Status: **wykonane**
Commit: `2fad726`

- usunąć polecenia powłoki zależne od systemu ze skanera sekretów;
- poprawnie sklasyfikować Site OS w ESLint;
- ignorować niekompletne i zagnieżdżone katalogi zależności.

Warunek odbioru: lint i skan sekretów przechodzą bez fałszywych błędów.

### K3. Naprawić bezpieczeństwo AI Sales OS

Status: **wykonane**
Commity: `4f61985`, `d406a8a`

- wykonać czystą instalację z lockfile;
- podnieść NextAuth do bezpiecznej wersji kompatybilnej;
- przygotować kontrolowaną migrację Next.js;
- uruchomić Prisma generate, typecheck, lint, build i test logowania;
- zablokować publiczny tunel, jeśli bramka autoryzacji nie przejdzie.

Warunek odbioru: brak krytycznych podatności produkcyjnych i zielone gates.

### K4. Dodać bootstrap Ubuntu

Status: **zaimplementowane, oczekuje na pełny przebieg CI**

- sprawdzić/doinstalować natywny Node LTS, npm, Git i biblioteki Electron;
- opcjonalnie instalować `sqlite3`, klienta PostgreSQL i Docker;
- wykrywać WSL z binariami Windows i jasno blokować taki miks;
- dodać tryb `--check` bez zmian systemowych;
- uruchomić build oraz smoke test na Ubuntu CI.

Warunek odbioru: świeże Ubuntu wykonuje check, instalację, build i smoke test według jednej
instrukcji.

### K5. Zbudować i sprawdzić paczki Linux

Status: **oczekuje**

- AppImage;
- DEB;
- start bez Node.js;
- zapis danych użytkownika;
- połączenie z lokalną Ollamą;
- kontrolowane zachowanie przy braku Docker/SQLite/PostgreSQL.

Warunek odbioru: artefakty startują na czystym Ubuntu 22.04/24.04.

## WAŻNE

### W1. Jeden diagnostyczny status zależności

- zwracać: dostępne, brakujące, wyłączone i błąd;
- nie przedstawiać SQLite/PostgreSQL/Dockera jako aktywnych, gdy brak programu lub demona;
- dodać prostą akcję naprawczą odpowiednią dla Ubuntu.

### W2. Intuicyjny kreator integracji

- kafelki: AI lokalne, AI chmurowe, poczta, kalendarz, AI Sales, Site OS, MCP;
- dla każdego: `Połącz`, `Sprawdź`, `Uruchom`, `Odłącz`;
- automatycznie wykrywać lokalny adres, port i istniejącą instancję;
- pokazywać użytkownikowi rezultat, a szczegóły techniczne chować w raporcie.

### W3. Site OS: zarządzanie procesem i portem

- wykryć już uruchomioną instancję;
- przy zajętym porcie otworzyć istniejącą instancję lub wybrać kolejny port;
- dodać endpoint stanu i czytelny smoke test;
- zachować lokalne grafiki i projekty po restarcie.

### W4. MCP stdio na Ubuntu

- menedżer procesów z allowlistą komend i katalogów;
- jawna konfiguracja serwera, timeout, restart i limit pamięci;
- oddzielne zgody dla odczytu, zapisu i działań wychodzących;
- pełny dziennik oraz przycisk zatrzymania.

### W5. Jedna bramka jakości

Nowy skrypt powinien kolejno sprawdzać:

1. skan sekretów;
2. lint;
3. typecheck/build;
4. szybkie testy głównej aplikacji;
5. Site OS smoke;
6. AI Sales gates, jeśli jego zależności są zainstalowane.

## OPTYMALIZACJE

### O1. Podział testów

- `test:quick` dla zmian lokalnych;
- `test:full` dla wydania i nocnego CI;
- raport najwolniejszych testów;
- kontrola wiszących timerów i uchwytów.

### O2. Rozmiar aplikacji

- zmierzyć największe chunki;
- rozdzielić ciężkie ekrany i biblioteki PDF/AI;
- usunąć pozorne dynamiczne importy, które i tak trafiają do głównego chunka;
- nie refaktoryzować dużych plików bez testu zachowania.

### O3. Lekki profil lokalny

- domyślnie jeden model Ollamy;
- nie uruchamiać Qdrant/Mem0/Dockera bez potrzeby;
- limity kontekstu, równoległości i czasu;
- szybki fallback 1.7B przy dużym obciążeniu.

### O4. Powtarzalne obrazy i wydania

- przypiąć wersje obrazów Docker zamiast `latest`;
- rozdzielić artefakty Windows/Linux/Android w wydaniu;
- dodać sumy kontrolne;
- publikować dopiero po przejściu testu instalacji.

## ROZBUDOWA

### R1. Trwały agent wykonawczy

Rozwinąć istniejący pipeline:

`Planner -> Coder -> Tester -> Debugger -> Reviewer`

Każdy krok zapisuje:

- identyfikator zadania i idempotency key;
- wejście, wynik i dowód;
- zmienione pliki;
- komendę testową i rezultat;
- decyzję review;
- checkpoint umożliwiający wznowienie.

### R2. Bezpieczne narzędzia generowane

Rozwinąć `tools/generated/`:

- manifest narzędzia;
- kontrola składni;
- self-test;
- izolowany katalog roboczy;
- limit czasu i rozmiaru wyjścia;
- aktywacja dopiero po wyniku PASS;
- wersjonowanie i wycofanie.

### R3. Pamięć decyzji

Zachować IndexedDB jako lekki domyślny magazyn i dodać:

- typowane decyzje architektoniczne;
- link do zadania, commita i testu;
- okresowe czyszczenie oraz eksport;
- opcjonalny adapter SQLite/Qdrant, bez obowiązkowego uruchamiania usług.

### R4. Centrum autonomii

Jeden ekran powinien pokazywać:

- cel i aktualny krok;
- kolejkę agentów;
- wymagane zgody;
- diff przed zapisem;
- testy i dowody;
- ostatni checkpoint;
- `Pauza`, `Wznów`, `Cofnij`.

## Kolejność iteracji

1. K3: AI Sales bezpieczeństwo i kompletna instalacja.
2. K4: bootstrap Ubuntu.
3. K5: paczki AppImage/DEB.
4. W1 + W2: diagnostyka i prosty kreator integracji.
5. W3: autonomiczne uruchamianie Site OS i tunelu.
6. W4: MCP stdio.
7. W5 + O1: jedna szybka bramka jakości.
8. R1-R4: trwała autonomia z checkpointami i rollbackiem.

## Format raportu iteracji

Każda iteracja kończy się:

```text
STATUS:
wykonane
problemy
zmienione pliki
wyniki testów
następny krok
```
