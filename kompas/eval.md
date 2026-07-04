# KOMPAS — 12 scenariuszy akceptacyjnych (eval)

Perspektywa: jedna osoba, nie-programista. Każdy scenariusz ma odpowiadający spec e2e
w `e2e/` (S01→s01.spec.ts itd.). „Postęp" tego runu = mniej czerwonych scenariuszy.
Status utrzymywany przez `verify.sh` → `EVIDENCE/verify-latest.txt`.

## Pętla produktu
wpis dzienny → wzorzec tygodniowy → JEDEN aktywny zakład → działania z DOWODEM → wynik vs przewidywanie

---

### S01 — Wpis dzienny w < 1 minutę
Otwieram aplikację, na starcie widzę pole wpisu dziennego. Piszę 2 zdania, wybieram
nastrój/energię (1 dotknięcie), zapisuję. Wpis pojawia się na liście dzisiaj z godziną.
**Kryterium:** od wejścia do zapisanego wpisu ≤ 3 interakcje; wpis widoczny natychmiast.

### S02 — Wpis przetrwa restart
Zapisuję wpis, zamykam kartę/przeglądarkę całkowicie, otwieram ponownie.
**Kryterium:** wpis nadal jest, z tą samą treścią i znacznikiem czasu.

### S03 — Znacznik czasu nie do podrobienia z UI
Próbuję zmienić datę/godzinę istniejącego wpisu lub dowodu.
**Kryterium:** UI nie daje żadnej ścieżki edycji znacznika czasu; timestamp nadaje system
przy zapisie.

### S04 — Wzorzec tygodniowy z realnych wpisów
Po ≥ 5 wpisach z ≥ 3 różnych dni otwieram „Tydzień". Widzę wzorzec: liczby (ile wpisów,
rozkład nastroju/energii per dzień) wyliczone z MOICH danych.
**Kryterium:** wartości zgadzają się z wpisami (test wstrzykuje znane dane i sprawdza sumy);
przy < 5 wpisach ekran mówi wprost, że danych jest za mało — nie zmyśla wzorca.

### S05 — Analiza AI: propozycja zakładu, człowiek decyduje
Mam klucz API (w teście: stub). Klikam „Analiza tygodnia" → dostaję JEDNĄ propozycję
zakładu z przewidywaniem. Mogę: zaakceptować / edytować / odrzucić. Nic nie aktywuje się samo.
**Kryterium:** bez mojej akceptacji zakład nie istnieje; po akceptacji jest AKTYWNY.

### S06 — Bez klucza API: uczciwa degradacja
Nie mam klucza. Ekran tygodnia pokazuje lokalne statystyki oznaczone „statystyka lokalna —
bez AI" i pozwala wpisać zakład ręcznie.
**Kryterium:** nigdzie nie pojawia się sugestia, że to analiza AI; ręczny zakład działa.

### S07 — Tylko JEDEN aktywny zakład
Mam aktywny zakład. Próbuję dodać drugi (ręcznie lub przez akceptację propozycji).
**Kryterium:** system odmawia z komunikatem wyjaśniającym (najpierw rozstrzygnij bieżący);
aktywny pozostaje dokładnie jeden.

### S08 — Działanie można domknąć TYLKO z dowodem
Do aktywnego zakładu dodaję działanie. Próbuję oznaczyć je „zrobione" bez dowodu.
**Kryterium:** system ODMAWIA i mówi dlaczego („done istnieje tylko z artefaktem dowodowym");
przycisk domknięcia bez dowodu nie istnieje albo prowadzi wyłącznie do formularza dowodu.

### S09 — Trzy typy dowodu działają
Domykam trzy działania trzema typami dowodu: (a) plik/zdjęcie, (b) notatka (timestamp
systemowy), (c) link URL.
**Kryterium:** każde przejście w „done" ma podpięty artefakt; artefakt da się obejrzeć
z poziomu działania; plik przetrwa restart (S02 dla blobów).

### S10 — Rozstrzygnięcie zakładu: wynik vs przewidywanie
Zakład dobiega końca (termin lub decyzja). Rozstrzygam: sprawdziło się / nie sprawdziło
/ nierozstrzygalne + wpisuję czego się nauczyłem. Widzę obok siebie: przewidywanie z dnia
startu i wynik.
**Kryterium:** przewidywanie wyświetlane przy rozstrzyganiu jest ORYGINALNE (niezmienione);
po rozstrzygnięciu zakład przechodzi do historii i można aktywować następny.

### S11 — Eksport markdown odzwierciedla prawdę
Klikam „Eksport". Dostaję plik .md z wpisami, zakładami (aktywny + historia), działaniami
i statusem dowodów.
**Kryterium:** działanie bez dowodu NIGDY nie figuruje w eksporcie jako zrobione; liczby
w eksporcie = liczby w bazie (test porównuje).

### S12 — Podwójny submit i odświeżenie w trakcie zapisu nie psują danych
Klikam „Zapisz" dwa razy szybko; osobno: odświeżam stronę tuż po zapisie.
**Kryterium:** brak zduplikowanych wpisów; baza po odświeżeniu spójna (wpis jest dokładnie
raz albo wcale — nigdy w połowie).
