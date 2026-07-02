# KOMPAS — dziennik decyzji

Każda decyzja wykonawcza i architektoniczna tego runu, z uzasadnieniem i odrzuconą
alternatywą. Format: **D# — decyzja** / dlaczego / co odrzucono i czemu.

---

## D0 — Bramka FAZY 0 (wywiad) odrzucona przez użytkownika → pełna autonomia
Zadałem 4 pytania architektoniczne (lokalizacja kodu, granica API, definicja dowodu,
źródło zakładu) przez AskUserQuestion. Użytkownik odrzucił dialog bez odpowiedzi
i potwierdził tylko model (Fable 5). Interpretacja: run ma iść autonomicznie, a
rozstrzygnięcia loguję tu — użytkownik przeczyta po fakcie i może każde unieważnić.
**Odrzucona alternatywa:** ponowić pytania — odrzucona, bo odrzucony dialog ponawiany
verbatim to nękanie; kontrakt i tak przewiduje „decyzje architektoniczne podejmujesz sam".

## D1 — Lokalizacja: podkatalog `kompas/` w repo talent620/jarvis, branch `claude/functionality-modification-access-z9kod1`
Dostęp push tej sesji jest ograniczony do tego repo i brancha. Izolowany podkatalog
z własnym `package.json` daje „pusty folder" z kontraktu bez dotykania produktu JARVIS.
**Odrzucone:** (a) root repo — kolizje konfiguracji Vite/tsc/Vitest z JARVIS-em;
(b) osobne repo — brak gwarancji uprawnień (`add_repo` mogłoby nie objąć nowego repo),
ryzyko zablokowania całego runu na pierwszym pushu.

## D2 — Izolacja bramek JARVIS-a: `kompas` dopisany do `ignores` w root `eslint.config.js`
Root `eslint .` z flat configiem lintowałby też `kompas/` (configi `recommended` działają
globalnie), więc kod KOMPAS-a mógłby wywrócić CI JARVIS-a. Jedna addytywna linia w ignores;
KOMPAS ma własny lint w swoim pakiecie. Vitest roota (`tests/**`) i tsc (`include: ["src"]`)
i tak nie widzą podkatalogu.
**Odrzucone:** wpięcie KOMPAS-a w bramki JARVIS-a — sprzeczne z izolacją produktów i z
zakazem pracy poza dokumentem (musiałbym utrzymywać zgodność z regułami cudzego produktu).

## D3 — Granica Anthropic API: klucz użytkownika lokalnie + deterministyczny stub w e2e
Produkt: użytkownik wkleja własny klucz (trzymany w localStorage, nigdy w kodzie/bundlu);
1 call `messages` przy analizie tygodniowej. Testy e2e: Playwright przechwytuje żądanie
(`page.route`) i zwraca deterministyczny fixture — zero sieci w testach. Bez klucza:
analiza pokazuje lokalne statystyki wzorca oznaczone wprost „statystyka lokalna — bez AI"
(nigdy nie udaje analizy AI — zasada zerowa dotyczy też nas).
**Odrzucone:** (a) klucz build-time `VITE_*` — ląduje w bundlu PWA, wyciek; (b) pełny stub
w produkcie — „analiza AI" byłaby symulacją udającą produkt.

## D4 — Dowód „done": trzy typy artefaktów, wymagany ≥1, stan `done` konstruowalny tylko z dowodem
Typy: zdjęcie/plik (blob w sql.js), notatka z niemodyfikowalnym znacznikiem czasu
(timestamp nadaje system, nie użytkownik), link URL. Domknięcie działania bez artefaktu
jest niemożliwe na poziomie modułu stanu (jedyna funkcja przejścia w `done` wymaga
argumentu-dowodu; UI nie ma innej ścieżki). To wprost odpowiedź na kontekst krytyczny
(poprzednik raportował niewykonane operacje).
**Odrzucone:** (a) tylko zdjęcie — zabija działania niematerialne (rozmowa, decyzja);
(b) dowolny tekst bez wymuszonego timestampu — zbyt łatwe „napisać, że zrobione".

## D5 — Źródło zakładu: AI proponuje (gdy klucz), człowiek zawsze akceptuje/edytuje/odrzuca
Analiza tygodniowa proponuje JEDEN zakład z przewidywaniem; bez klucza użytkownik
formułuje zakład sam, widząc lokalne statystyki wpisów. Aktywny może być tylko jeden
zakład — próba dodania drugiego jest odrzucana z komunikatem.
**Odrzucone:** zakład tylko ręczny — słabiej domyka pętlę wpis→wzorzec→zakład;
zakład auto-aktywowany przez AI — narusza zasadę ludzkiej akceptacji.

## D6 — Trwałość: sql.js + zapis do IndexedDB po każdej mutacji, schemat wersjonowany
Baza sql.js (SQLite w WASM) serializowana do IndexedDB po każdej transakcji zapisu
(eksport bajtów). Wersja schematu w tabeli `meta`; migracje tylko w przód. Eksport
markdown czyta z tej samej bazy (jedno źródło prawdy).
**Odrzucone:** localStorage jako nośnik bazy — limit ~5 MB zabija dowody-bloby;
czysty IndexedDB bez SQL — kontrakt wymaga sql.js.

## D7 — Testy: wyłącznie e2e Playwright jako miara postępu (bez testów jednostkowych w F1)
Kontrakt: „postęp = mniej czerwonych scenariuszy" z eval.md; 12 scenariuszy = 12 speców
e2e. Testy jednostkowe dodajemy tylko, jeśli adwersarze (F5) wskażą lukę niewykrywalną
z poziomu e2e. Chromium z `/opt/pw-browsers` (preinstalowany; bez `playwright install`).
**Odrzucone:** równoległa piramida unit+e2e od startu — over-engineering ponad kontrakt.

## D8 — PWA minimalna: manifest + service worker cache-first dla powłoki
Manifest + prosty SW (precache bundla, offline shell). Bez push, bez sync w tle —
kontrakt nie wymaga.
**Odrzucone:** Workbox/strategie zaawansowane — warstwa ponad dokument.
