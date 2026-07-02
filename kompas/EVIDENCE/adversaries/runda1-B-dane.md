# Adwersarz B (dane) — runda 1

## PROBLEMY

### P1 (krytyczny) — Nieudany trwały zapis połykany po cichu; `flush()` daje fałszywą gwarancję
`db.ts` (persistChain `.catch(() => {})`). Pełny storage (QuotaExceededError) → UI mówi
„zapisane”, restart cofa dane; każda kolejna mutacja ginie po cichu. Narusza zasadę zerową i S02.
Naprawa: rejestrować błąd zapisu, powiadamiać UI, `flush()` ma zgłaszać porażkę; formularz
nie może się czyścić po nieudanym zapisie.

### P2 (krytyczny) — Dwie karty: last-writer-wins całym snapshotem, zero detekcji
`db.ts` (idbSave bezwarunkowy put całości, brak wersji). Zapomniana karta z rana nadpisuje
wieczorem cały dzień pracy drugiej karty. Naprawa: licznik wersji sprawdzany w tej samej
transakcji readwrite; przy niezgodności abort + komunikat.

### P3 (krytyczny) — Przejściowy błąd odczytu przy starcie → świeża baza → pierwszy zapis niszczy stary snapshot
`db.ts` (catch w initDb → bytes=null → pusta baza bez słowa). Błąd odczytu zamienia się
w trwałe skasowanie historii. Naprawa: odróżnić „brak snapshotu” od „błąd odczytu”;
przy błędzie zakaz zapisu + jawny komunikat.

### P4 (wysoki) — Uszkodzony snapshot → initDb odrzuca → aplikacja wisi na „Wczytywanie…”
`db.ts` + `App.tsx` (initDb().then bez catch). Użytkownik bez informacji i ratunku.
Naprawa: catch + ekran błędu; NIE kasować danych automatycznie.

### P5 (wysoki) — Bet.tsx: żadna mutacja nie czeka na flush(); UI pokazuje „zrobione” przed trwałością
`Bet.tsx` (saveAction/submitProof/saveResolve bez flush — niespójne z Today/Week).
Naprawa: await flush() przed zamknięciem modala/wyczyszczeniem stanu.

### P6 (średni) — Podwójny klik „Zapisz dowód” przy pliku → dwa proofs, drugi na zawsze osierocony (duplikat blobu)
`Bet.tsx` (await arrayBuffer() otwiera okno wyścigu; brak guardu/disabled).
Naprawa: guard jak w Today + disabled; w closeAction sprawdzić stan przed INSERT-em.

### P7 (średni) — closeAction = dwa osobne snapshoty; przerwanie między nimi zostawia osierocony blob; koszt 2× eksport bazy
`bets.ts` (dwa run() = dwa pełne eksporty bazy). Naprawa: jedna partia (BEGIN/COMMIT
+ jeden persist po całości).

## ZBADANE, BEZ LUKI
Kolejność snapshotów w persistChain (synchroniczny export, kolejka FIFO); flush obejmuje
wcześniejsze zapisy; podwójny klik w Today (savingRef); podwójny klik bet-manual-save/
ai-accept (createBet synchroniczny → BetConflictError); podwójny klik action-save;
odświeżenie tuż po zapisie w Today (await flush → „raz albo wcale”).
