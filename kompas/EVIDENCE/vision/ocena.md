# FAZA 4 — ocena wizyjna (przed/po)

Obejrzano WSZYSTKIE 13 zrzutów `before/` (390×844, build produkcyjny, AI stub).
Ocena względem eval.md i heurystyk kontraktu:

## Heurystyki kontraktu
1. **Czy pole dowodu jest nieomijalne wzrokowo?** TAK — jedyna droga do „zrobione"
   to przycisk „Domknij z dowodem" → modal „Dowód wykonania" z wprost zapisaną zasadą
   („Stan „zrobione” istnieje tylko z artefaktem dowodowym. Czas dowodu nadaje system.");
   próba zapisu bez dowodu → czerwony alert z wyjaśnieniem (08b). Brak checkboxów.
2. **Czy status zakładu jest widoczny od razu?** TAK — zielona plakietka „aktywny"
   w lewym górnym rogu karty + data startu (07); pusty stan mówi, dokąd iść (06).
3. **Czy nie-programista zrozumie ekran bez instrukcji?** TAK — każdy ekran ma jedno
   główne działanie; „za mało danych" tłumaczy ile potrzeba (02); plakietka
   „Statystyka lokalna — bez AI" jasno odróżnia tryby (04); rozstrzyganie tłumaczy
   „Porównaj wynik z przewidywaniem z dnia startu (powyżej)" (10).

## Problemy znalezione i NAPRAWIONE (before → after)
1. **Zakład: zgnieciony tekst działania** (before/07) — trzy kolumny w wierszu działania
   ściskały tekst do szerokości ~1/3 ekranu (zawijanie w 4 linie). Naprawa: układ pionowy
   (tekst pełna szerokość, pod nim status + przycisk) — `Bet.css`. Dowód: after/07.
2. **Tydzień: niewyrównane kolumny dni** (before/04) — „wpisów: N" miało zmienną
   szerokość, przez co trzecia kolumna skakała. Naprawa: stała szerokość drugiej kolumny —
   `Week.css`. Dowód: after/04.

## Świadomie NIE naprawiane (zakaz over-engineeringu)
- Modal dowodu pokazuje „Zapisz dowód" przed wyborem typu — kliknięcie bez wyboru daje
  jasną odmowę z instrukcją (08b), co jest zamierzonym zachowaniem scenariusza S08;
  ukrywanie przycisku dodałoby stan bez wartości dowodowej.
- „Zapisywanie…" na przycisku (03) — celowy, uczciwy feedback trwającego zapisu (S12).

## Werdykt
Po naprawach wszystkie ekrany czytelne dla nie-programisty; 12/12 scenariuszy pozostaje
zielonych (EVIDENCE/verify-latest.txt po F4).
