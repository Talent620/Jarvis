# Audyt techniczny JARVIS

Data audytu: 2026-07-24  
Gałąź: `codex/site-os-image-library`  
Punkt odniesienia: `99e5ec9` oraz poprawki audytowe `c3a409b`, `2fad726`

## 1. Wniosek

JARVIS nie jest prototypem do przepisania od zera. To duży, działający system React/TypeScript z
aplikacją Electron, wersjami mobilnymi, pamięcią lokalną, rozbudowanym zestawem narzędzi,
integracjami AI, AI Sales OS i Site OS. Główna aplikacja buduje się produkcyjnie, a zdecydowana
większość testów przechodzi.

Największe ryzyko nie leży w braku funkcji, lecz w spójności dystrybucji i utrzymania:

- świeże Ubuntu nie ma jednego, sprawdzonego bootstrapu środowiska;
- AI Sales OS wymagał aktualizacji Next/Auth i osobnego przygotowania lokalnych zależności;
- część zdolności systemowych wymaga zewnętrznych programów (`docker`, `sqlite3`, `psql`);
- pełny zestaw testów jest wolny, a osobne produkty mają różne bramki jakości;
- kilka workflow publikuje artefakty do wspólnego wydania `latest`, co grozi kolizją;
- aktualny system MCP jest klientem HTTP/IPC w stylu MCP, ale nie jest jeszcze kompletnym
  menedżerem procesów MCP stdio na Ubuntu.

Ocena bieżąca: **działający fundament, jeszcze nie gotowy do bezobsługowej instalacji na czystym
Ubuntu**.

## 2. Zakres repozytorium

Repozytorium zawiera 1223 śledzone pliki. Główne obszary:

| Obszar | Rola | Stan |
| --- | --- | --- |
| `src/` | aplikacja React, logika agentowa, pamięć, narzędzia, UI | działa, duży zakres |
| `electron/` | desktop, IPC i ograniczone narzędzia systemowe | działa, wymaga testu paczki Linux |
| `tests/` | testy Vitest logiki i kontraktów | bardzo szerokie pokrycie |
| `site-os/` | autonomiczny kreator stron w przeglądarce | działa lokalnie na porcie 3210 |
| `sales-os/` | osobna aplikacja Next/Prisma/PostgreSQL | blokowana lokalnie przez setup i zależności |
| `android/`, `ios/` | aplikacje Capacitor | poza główną ścieżką Ubuntu |
| `proxy/` | BFF Cloudflare dla usług zewnętrznych | działa jako osobny komponent |
| `server/` | Mem0, Qdrant i Ollama przez Docker Compose | opcjonalna infrastruktura |
| `kompas/` | osobny produkt/moduł | ma własną konfigurację jakości |
| `.github/workflows/` | CI, wydania Windows/Linux i pozostałe automatyzacje | rozbudowane, częściowo nakładające się |

## 3. Stos i zależności

### Główna aplikacja

- Node.js + npm
- React 18, TypeScript 5.6, Vite 5
- Electron 33 i electron-builder 25
- Capacitor 6
- Dexie/IndexedDB do trwałych danych
- Vitest 2 i ESLint 9

Audyt produkcyjnych zależności głównej aplikacji: **0 znanych podatności**.  
Pełny audyt wraz z narzędziami developerskimi: **19 podatności** (2 krytyczne, 14 wysokich,
3 umiarkowane), przede wszystkim w Electronie, Vite/Vitest, electron-builderze i ich
zależnościach. Ich aktualizacja wymaga migracji wersji głównych i osobnej walidacji paczek.

### AI Sales OS

- Next 15.5.21
- NextAuth 4.24.x
- Prisma 5.22 + PostgreSQL
- osobny `package-lock.json` i osobny cykl instalacji

Po migracji audyt wszystkich zależności AI Sales pokazuje **0 podatności**. NextAuth został
podniesiony do 4.24.15, a framework do Next.js 15.5.21 wraz z nowym kontraktem parametrów tras.

### Python

Python nie jest zależnością uruchomieniową głównego JARVISA. Repozytorium nie ma
`requirements.txt`, `pyproject.toml` ani innego manifestu Python. Python pojawia się jedynie w
opcjonalnym scenariuszu treningu LoRA, który wymaga zewnętrznego środowiska ML. Dodawanie
ciężkich bibliotek Python do instalacji bazowej byłoby zbędne.

## 4. Uruchamianie i Ubuntu

Istnieją:

- `npm run dev` i `npm run build`;
- `npm run electron:dev`;
- `npm run desktop:ubuntu`;
- workflow Ubuntu 22.04 budujący AppImage oraz DEB;
- konfiguracja electron-builder dla `AppImage` i `deb`.

Dodano `scripts/bootstrap-ubuntu.sh`, który kontroluje środowisko bez zmian albo instaluje
natywny Node.js 22 LTS, biblioteki Electrona i zależności obu aplikacji. Środowisko WSL dostępne
podczas audytu ma Ubuntu 26.04, ale nie ma natywnego Node.js. Polecenie
`npm` wskazuje na instalację Windows w `/mnt/c/Program Files/nodejs`, co jest niepoprawnym,
mieszanym środowiskiem. Lokalny build Ubuntu wymaga natywnego Node LTS, npm i bibliotek
systemowych Electron. Docker CLI jest widoczny, lecz demon nie działa.

Paczka AppImage/DEB nie wymaga Node.js do zwykłego uruchomienia, ale jej lokalne zbudowanie i
rozwój wymagają kompletnego bootstrapu.

## 5. Integracje AI

Zaimplementowane są:

- routing wielu dostawców chmurowych;
- Ollama przez natywne `/api/chat`, także z wywołaniami narzędzi;
- model lokalny `qwen3.5:4b` dobrany do sprzętu 16 GB RAM / GTX 1050 Ti 4 GB;
- agent badawczy zbierający źródła i syntezujący wynik lokalnym modelem;
- fallback dla modeli Ollamy bez obsługi narzędzi;
- mechanizmy wyboru modelu, prewarm, limity i tryby oszczędne;
- integracje Google, poczta, kalendarz, n8n, Home Assistant i AI Sales OS.

Ryzyka:

- część integracji jest aktywna dopiero po ręcznym podaniu klucza, tokenu lub adresu;
- połączenie z AI Sales OS jest funkcjonalne, ale jego instalacja nie jest jeszcze niezawodna;
- tunel powinien być aktywowany dopiero po kontroli autoryzacji i ograniczeniu nasłuchu;
- konfiguracje wielu dostawców i MCP nadal są prezentowane technicznie, a nie jako jeden prosty
  kreator połączenia.

## 6. MCP i narzędzia systemowe

Istnieją dwie warstwy:

1. Klient MCP JSON-RPC przez HTTP z allowlistą hostów.
2. Systemowe narzędzia IPC Electrona, rejestrowane jako narzędzia MCP-style:
   pliki, Git, ograniczony terminal, SQLite/PostgreSQL, przeglądarka, Docker, HTTP i generator
   narzędzi.

Zabezpieczenia już obecne:

- granica katalogu roboczego;
- allowlista poleceń bez uruchamiania dowolnej powłoki;
- tylko odczyt dla zapytań bazodanowych;
- kopia pliku przed zapisem;
- dziennik operacji;
- składnia i self-test przed zachowaniem wygenerowanego narzędzia;
- fail-safe dla niesklasyfikowanych narzędzi.

Braki:

- `sqlite3` i `psql` są wymaganymi zewnętrznymi programami, nie są dostarczane z aplikacją;
- Docker wymaga działającego demona;
- brak adaptera uruchamiającego lokalne serwery MCP stdio z kontrolą procesu i uprawnień;
- backup dotyczy zapisywanego pliku, ale nie tworzy kompletnego punktu przywracania całej operacji;
- rollback Git i podgląd zmian nie są jeszcze jednym intuicyjnym przepływem w UI.

## 7. Pamięć i RAG

Zaimplementowane są:

- dane aplikacji w IndexedDB przez Dexie;
- pamięć faktów, epizodów, decyzji i historii działań;
- lokalne oraz chmurowe embeddingi;
- wyszukiwanie semantyczne i leksykalne z MMR/RRF;
- generowany indeks repozytorium `src/generated/knowledge-index.json`;
- szyfrowane i zwykłe kopie danych;
- moduły refleksji, world model i uczenia przepływów.

To spełnia znaczną część celu pamięci długoterminowej bez obowiązkowego serwera. SQLite i Qdrant
są opcjonalnymi rozszerzeniami, a nie jedynym źródłem prawdy. Należy zachować ten lekki model na
sprzęcie użytkownika i nie uruchamiać ciężkiej bazy wektorowej bez potrzeby.

## 8. Agenci

Repozytorium zawiera planner, wykonanie celu, pipeline ról oraz wyspecjalizowanych agentów.
Przepływ Planner -> Coder -> Tester -> Debugger -> Reviewer istnieje jako fundament, podobnie jak
agent integracji, diagnostyka, self-heal i historia działań.

Braki do poziomu produkcyjnego:

- każdy krok nie ma jeszcze trwałego, jednolitego rekordu wejścia, wyjścia, dowodu i kosztu;
- przerwanie procesu aplikacji nie gwarantuje wznowienia dokładnie od ostatniego kroku;
- tester i reviewer nie są obowiązkową bramką dla każdej wygenerowanej zmiany;
- brakuje zbiorczego ekranu kolejki, zgód, diffu, testu i rollbacku.

## 9. Wyniki walidacji

| Kontrola | Wynik |
| --- | --- |
| `npm run build` | PASS, 2410 modułów |
| pełny Vitest przed poprawką | 2770 PASS, 3 FAIL |
| testy regresji po poprawce | 5/5 PASS |
| ESLint po poprawce | PASS |
| skan sekretów po poprawce | PASS |
| Site OS | serwer już działa na `127.0.0.1:3210`; drugi start poprawnie zgłasza zajęty port |
| narzędzia systemowe | pliki, Git, terminal, HTTP, browser i generator PASS |
| SQLite/PostgreSQL | pominięte: brak klientów CLI |
| Docker | CLI wykryty, demon niedostępny |
| AI Sales gates | PASS na Next.js 15.5.21 |
| AI Sales npm audit | PASS, 0 podatności |
| bootstrap Ubuntu `--check` | PASS diagnostyki; prawidłowo wykrywa brak natywnego Node/npm w WSL |

Trzy błędy pełnego zestawu zostały usunięte w `c3a409b`: jawna klasyfikacja ryzyka agenta
badawczego oraz aktualizacja kontraktu testów natywnej Ollamy.

## 10. Lista problemów

### Krytyczne

1. Paczki AppImage/DEB nie zostały jeszcze uruchomione na czystym Ubuntu po instalacji.
2. Bootstrap Ubuntu jest zaimplementowany, ale pełny tryb instalacji czeka na wykonanie w CI lub
   środowisku z uprawnieniami `sudo`.

### Ważne

1. Zdolności SQLite/PostgreSQL/Docker są prezentowane mimo brakujących programów lub demona.
2. Brak menedżera lokalnych serwerów MCP stdio.
3. Site OS przy zajętym porcie kończy się surowym wyjątkiem zamiast wskazać działającą instancję
   lub wybrać bezpieczny wolny port.
4. Publikacja wielu platform do wspólnego wydania `latest` może powodować kolizje artefaktów.
5. Brak jednej bramki jakości obejmującej główną aplikację, Site OS i AI Sales OS.

### Optymalizacje

1. Pełne testy trwały około 7 minut; należy wprowadzić szybki zestaw PR i pełny zestaw nocny.
2. Build ostrzega o dużych chunkach oraz modułach importowanych równocześnie statycznie i
   dynamicznie.
3. Główne pliki `App.tsx`, `Settings.tsx` i `tools.ts` mają duży zakres odpowiedzialności.
4. Obrazy Docker `latest` nie zapewniają powtarzalnych wdrożeń.

### Nieużywany lub niespójny kod

Nie znaleziono podstaw do masowego usuwania kodu. Repozytorium zawiera wiele osobnych produktów,
platform i funkcji warunkowych, więc proste raporty "unused" byłyby mylące. Refaktoryzację należy
prowadzić dopiero po pokryciu konkretnego przepływu testem i potwierdzeniu braku użycia.

## 11. Rekomendacja sprzętowa

Dla badanego komputera najlepszy domyślny profil lokalny:

- `qwen3.5:4b` jako model jakościowy do rozmowy, researchu i narzędzi;
- mniejszy model 1.7B jako szybki fallback;
- kontekst i równoległość ograniczone tak, aby nie wypierać aplikacji z 16 GB RAM;
- GPU używane przez Ollamę automatycznie, bez wymuszania pełnego offloadu;
- Qdrant, Mem0 i Docker uruchamiane tylko dla funkcji, które naprawdę ich potrzebują.

## 12. Decyzja architektoniczna

Najmniej inwazyjna droga do stabilnego autonomicznego JARVISA:

1. zachować React/Electron/Dexie/Ollama;
2. ustabilizować instalację Ubuntu i moduły pomocnicze;
3. naprawić bezpieczeństwo AI Sales;
4. rozbudować istniejące IPC/MCP zamiast wprowadzać drugi framework agentowy;
5. dodać trwały dziennik wykonań i checkpointy;
6. udostępnić użytkownikowi jeden ekran: połącz, sprawdź, uruchom, zatrzymaj, cofnij.
