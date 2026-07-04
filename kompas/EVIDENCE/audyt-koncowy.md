# KOMPAS — niezależny audyt końcowy (po deklaracji FAZY 6)

Audyt przeprowadzony od zera na artefaktach repo (bez zaufania do podsumowań sesji).
Branch: `claude/functionality-modification-access-z9kod1`, HEAD audytu: `6ac0123` (= origin).

## 1. Repo i historia
Drzewo czyste, HEAD = origin. 11 commitów KOMPAS-a od `bd7d443` (harness, czerwony
baseline 0/12 — EVIDENCE/verify-2026-07-02T03-26-32Z.txt) do `6ac0123`.

## 2. Świeży pełny verify.sh (build produkcyjny)
`EVIDENCE/verify-2026-07-02T06-11-58Z.txt`: **build exit 0, 18 passed, e2e exit 0,
scenariusze 12/12 ZIELONE**. Trzeci niezależny zielony bieg (po 04-08-15Z i 05-13-01Z)
— wynik powtarzalny, nie jednorazowy.

## 3. Adekwatność mapowania test → wymaganie
Zweryfikowano asercje każdego speca względem kryteriów eval.md (nie „zielony test
techniczny”): S01 dokładnie 3 interakcje + czas HH:MM; S02 identyczny tekst i czas po
zamknięciu karty; S03 zero kontrolek edycji czasu (tag, zagnieżdżone pola, testid *edit*);
S04 ground truth 6 wpisów/3 dni + uczciwe „za mało” bez week-pattern; S05 propozycja ≠
zakład (bet-empty przed akceptacją), odrzucenie bez śladu; S06 plakietka „bez AI” + brak
ai-proposal + działający zakład ręczny; S07 odmowa z „rozstrzygnij” i dokładnie 1 aktywny
(tor ręczny i AI); S08 odmowa z wyjaśnieniem „dowod”, status bez zmian, zero checkboxów;
S09 trzy typy dowodu + podgląd artefaktu + czas systemowy + plik po restarcie; S10
ORYGINALNE przewidywanie przy rozstrzyganiu i w historii + werdykt słownie; S11 liczby
eksportu = zasiane dane, `[x]` wyłącznie z „dowód”, otwarte działanie `[ ]`; S12 dokładnie
1 wpis po podwójnym kliku (także po reload), spójność po odświeżeniu w trakcie zapisu.
Dodatkowo regresje adwersarskie (adv-integrity): wstrzyknięcie `- [x]` przez \n i U+2028,
pseudo-URL-e (`http://`, `https://.`, `http://#`, `http://:`) odrzucane, `HTTP://…` przyjmowany.

## 4. Ocena wizyjna (świeże zrzuty bieżącego builda: EVIDENCE/vision/final/)
- Widoczność aktywnego zakładu: zielona plakietka „aktywny” + data startu w nagłówku karty (final/07).
- Nieomijalność pola dowodu: jedyna droga to „Domknij z dowodem” → modal z zasadą zerową
  wypisaną wprost; próba zapisu bez artefaktu → czerwony alert z instrukcją (final/08b);
  status pozostaje „do zrobienia”.
- Zrozumiałość dla nie-programisty: jedno główne działanie na ekran, komunikaty pełnymi
  zdaniami po polsku (final/01–12).
- Brak komunikatów sugerujących wykonanie bez artefaktu: „zrobione” pojawia się wyłącznie
  po zapisie dowodu (final/09–11), eksport deklaruje zasadę wprost (final/12).

## 5. Próby dojścia do „done” (punkt 7 audytu)
- **Bez dowodu:** test S08 — odmowa, status bez zmian. ZAMKNIĘTE.
- **Pusty/pozorny link:** adv-integrity — `http://`, `https://.`, `http://#`, `http://:`
  odrzucane (walidacja new URL() + alfanumeryczny host). ZAMKNIĘTE.
- **Podwójny submit:** S12 (wpisy) + guard submittingRef/disabled na dowodzie (P6) +
  pre-check stanu i `rowsModified()` z ROLLBACK-iem w closeAction. ZAMKNIĘTE.
- **Dwie otwarte karty:** SONDA EMPIRYCZNA na buildzie produkcyjnym (skrypt jednorazowy,
  wynik poniżej): starsza karta przy zapisie dostaje twardą blokadę z bannerem
  („Dane zostały zmienione w innej karcie…”), dane nowszej karty NIE zostają nadpisane,
  wpis ze starszej karty NIE zapisuje się cicho.
  ```
  banner blokady w starszej karcie: true
  po reload: A obecny: true | B obecny (nie nadpisany!): true | C zapisany: false
  PROBE-PASS: dwie karty nie niszcza danych (P2 potwierdzone empirycznie)
  ```
- **Po błędzie zapisu/uszkodzeniu storage:** pokryte przeglądem kodu w rundzie 2 adwersarza B
  (EVIDENCE/adversaries/runda2-B-dane.md): błąd zapisu → flush() rzuca + trwały banner
  (nigdy cichy sukces); uszkodzony snapshot → ekran błędu bez kasowania danych; fałszywy
  konflikt po quocie usunięty. Bez symulacji quoty w e2e (ograniczenie odnotowane w FINAL.md).

## 6. FINAL.md vs dowody
Każde twierdzenie tabeli wskazuje istniejący spec i log; wszystkie cytowane pliki EVIDENCE
istnieją; sekcja ograniczeń (6 pozycji) i nota metodologiczna (Chromium-only, stub AI)
uczciwie zawężają deklaracje. Twierdzeń bez dowodu nie znaleziono.

## WERDYKT: FAZA 6 ZAAKCEPTOWANA
Naruszeń kontraktu nie znaleziono; naprawy nie były wymagane (0 iteracji naprawczych).

## Uruchomienie (build produkcyjny)
```
cd kompas && npm install && npm run build && npm run preview
```
→ aplikacja pod http://localhost:4317 (PWA; dane lokalnie w przeglądarce).
