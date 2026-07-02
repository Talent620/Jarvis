# KOMPAS — FINAL (FAZA 6, bramka końcowa)

Wyłącznie twierdzenia weryfikowalne. Każde ma dowód w `EVIDENCE/` albo w historii gita.
Zasada zerowa runu obowiązuje także tutaj: nic „zrobione” bez artefaktu.

## 1. Tabela 12 scenariuszy eval.md

Status z ostatniego pełnego biegu `verify.sh` (build=0, e2e=0, 18/18 testów) —
pełny log: `EVIDENCE/verify-latest.txt` (kopia archiwalna `EVIDENCE/verify-2026-07-02T04-08-15Z.txt`),
surowe wyniki testów: `EVIDENCE/e2e-latest.json`.

| Scenariusz | Status | Dowód (spec + log) |
|---|---|---|
| S01 wpis w ≤3 interakcjach, natychmiast widoczny z godziną | ZIELONY | `e2e/s01-daily-entry.spec.ts` → EVIDENCE/verify-latest.txt |
| S02 wpis przeżywa zamknięcie karty (treść + czas) | ZIELONY | `e2e/s02-persistence.spec.ts` → jw. |
| S03 zero ścieżek edycji znacznika czasu z UI | ZIELONY | `e2e/s03-immutable-timestamp.spec.ts` → jw. |
| S04 wzorzec z realnych danych; „za mało” zamiast zmyślania | ZIELONY | `e2e/s04-weekly-pattern.spec.ts` (ground truth 6 wpisów/3 dni) → jw. |
| S05 propozycja AI wymaga akceptacji; odrzucenie bez śladu | ZIELONY | `e2e/s05-ai-proposal.spec.ts` (stub API, zero sieci) → jw. |
| S06 bez klucza: plakietka „bez AI” + działający zakład ręczny | ZIELONY | `e2e/s06-no-key-degradation.spec.ts` → jw. |
| S07 dokładnie JEDEN aktywny zakład (ręczny i AI) | ZIELONY | `e2e/s07-one-active-bet.spec.ts` → jw. |
| S08 „zrobione” TYLKO z dowodem; odmowa z wyjaśnieniem | ZIELONY | `e2e/s08-done-requires-proof.spec.ts` → jw. |
| S09 trzy typy dowodu (plik/notatka/link); plik przeżywa restart | ZIELONY | `e2e/s09-three-proof-types.spec.ts` → jw. |
| S10 rozstrzygnięcie vs ORYGINALNE przewidywanie; historia | ZIELONY | `e2e/s10-bet-resolution.spec.ts` → jw. |
| S11 eksport .md nie kłamie (liczby=baza; [x] tylko z dowodem) | ZIELONY | `e2e/s11-export-truth.spec.ts` → jw. |
| S12 podwójny submit / odświeżenie w trakcie zapisu | ZIELONY | `e2e/s12-double-submit-refresh.spec.ts` → jw. |

Dodatkowa siatka regresji adwersarskich (poza 12 scenariuszami): `e2e/adv-integrity.spec.ts`
(wstrzyknięcie „- [x]” przez \n i U+2028; pseudo-URL-e `http://`, `https://.`, `http://#`,
`http://:` odrzucane; `HTTP://example.com` przechodzi) — 2 testy ZIELONE w tym samym logu.

## 2. Wynik verify.sh (ostatni pełny bieg)

Plik `EVIDENCE/verify-latest.txt` zawiera pełny output (build + 18 testów + tabela).
Kluczowe linie:
```
build exit: 0
18 passed
e2e exit: 0
zielone: 12/12
```
Historia wszystkich biegów (w tym CZERWONY baseline 0/12 sprzed produktu —
`EVIDENCE/verify-2026-07-02T03-26-32Z.txt`): pliki `EVIDENCE/verify-*.txt`.

## 3. Commity runu (branch `claude/functionality-modification-access-z9kod1`, repo talent620/jarvis)

| Commit | Opis |
|---|---|
| `bd7d443` | FAZA 0+1 — DECISIONS.md, eval.md (12 scenariuszy), harness e2e (czerwony baseline 0/12), verify.sh |
| `0f44565` | FAZA 2 — PLAN.md + wspólny rdzeń (db.ts, powłoka, stuby ekranów) |
| `6f64a4d` | FAZA 2 — stub kontraktowy bets.ts (umowa sygnatur między wykonawcami) |
| `6fd83cd` | FAZA 3 — cztery wycinki produktu (2 równoległych wykonawców), 12/12 zielonych |
| `1b596d3` | FAZA 4 — weryfikacja wizyjna: naprawa układu działań i wyrównania dni |
| `f1810a0` | FAZA 5 — naprawy po rundzie 1 adwersarzy (A1–A2, P1–P7) |
| `6907501` | FAZA 5 runda 2 — naprawy obejść (URL, U+2028, no-opy, fałszywy VersionConflict, anty-duplikaty) |

## 4. Decyzje

`DECISIONS.md` — 12 wpisów (D0–D11), każdy z uzasadnieniem i odrzuconą alternatywą,
w tym: bramka wywiadu odrzucona → autonomia (D0), lokalizacja w podkatalogu repo (D1),
klucz API lokalnie + stub w testach (D3), trzy typy dowodu i „done” konstruowalne tylko
z dowodem (D4), jeden commit integracyjny FAZY 3 (D9), naprawy adwersarzy i polityka
anty-duplikatowa (D10–D11).

## 5. Znane ograniczenia (uczciwie)

1. **Skalowanie trwałości z dużymi plikami dowodowymi:** każda mutacja serializuje CAŁĄ
   bazę (bloby włącznie) do IndexedDB — przy dziesiątkach MB zdjęć każdy jednozdaniowy
   wpis kosztuje re-zapis wszystkiego (czas/pamięć/quota). Świadomie nie przeniesiono
   blobów poza snapshot (DECISIONS D10 — poza kontraktem runu).
2. **Przy zablokowanym zapisie (konflikt kart) mutacje w pamięci są nadal widoczne w UI**
   — banner i rzucający `flush()` mówią prawdę, ale lista rośnie o dane, które nie zostaną
   utrwalone do czasu odświeżenia (EVIDENCE/adversaries/runda2-B-dane.md).
3. **Walidacja linku-dowodu sprawdza składnię URL, nie istnienie zasobu** — `https://example.com/nieistnieje`
   przejdzie; system dowodzi, że użytkownik COŚ podał, nie że zasób istnieje (offline-first
   uniemożliwia weryfikację sieciową).
4. **Analiza AI wymaga klucza użytkownika i sieci; call idzie z przeglądarki** — nagłówek
   `anthropic-dangerous-direct-browser-access`; klucz w localStorage tej przeglądarki
   (nie w bundlu), co jest kompromisem „zero backendu” (DECISIONS D3).
5. **Testowane wyłącznie na Chromium** (preinstalowany w środowisku CI) — Firefox/Safari/
   WebView bez pokrycia w tym runie.
6. **U+2028 w tekście wpisu jest spłaszczany w EKSPORCIE, ale w UI listy renderuje go
   przeglądarka** — bez wpływu na dane i eksport (test `adv-integrity`), czysto wizualne.

## 6. BRAMKA 30 DNI

Produkt uznajemy za PRZYJĘTY dopiero, gdy po 30 dniach realnego użycia:
- **≥ 20 dni** z co najmniej jednym wpisem dziennym,
- **≥ 4 zamknięte pętle** (zakład → działania → rozstrzygnięcie z werdyktem),
- **≥ 60% działań** domkniętych z dowodem (licznik „Działania z dowodem” na ekranie Eksport),
- **zero** stanów „zrobione” bez artefaktu (eksport .md: każda linia `- [x]` ma `— dowód:`).

Jeśli bramka nie przeszła — **nie dobudowuj**; zapytaj DLACZEGO nie używał.

---
*Uwaga metodologiczna: „ZIELONY” oznacza wynik testu e2e na buildzie produkcyjnym
w Chromium (headless). Run nie testował produktu na fizycznym telefonie ani z realnym
kluczem Anthropic — analiza AI jest pokryta deterministycznym stubem (S05), a jej realne
wywołanie pozostaje do pierwszego użycia z prawdziwym kluczem.*
