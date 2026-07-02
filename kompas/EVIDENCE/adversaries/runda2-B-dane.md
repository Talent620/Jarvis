# Adwersarz B (dane) — runda 2 (powtórkowa)

## Werdykty
- **P1 (prawda o zapisie): OBCHODZONA przez nowy błąd wersji** (fałszywy VersionConflict
  po quocie — patrz problem 1). Mechanizm sam w sobie działa (banner, flush rzuca).
- **P2 (dwie karty): ZAMKNIĘTA** — check-and-set w jednej transakcji readwrite (bez TOCTOU).
  Uwaga (ograniczenie, nie luka): przy saveLocked mutacje w pamięci dalej widać w UI —
  komunikuje to banner i rzucający flush.
- **P3/P4: ZAMKNIĘTA** — żadna ścieżka nie tworzy świeżej bazy po błędzie odczytu;
  uszkodzony snapshot → ekran błędu, zero kasowania.
- **P5/P6/P7: ZAMKNIĘTE.**

## Nowe problemy → wszystkie NAPRAWIONE w tej rundzie
1. **[POWAŻNY] Fałszywy VersionConflict po błędzie quota** (optymistyczny inkrement
   dbVersion przy planowaniu). → NAPRAWIONE: `expected` wyznaczane w momencie WYKONANIA
   zapisu z kolejki, wersja rośnie wyłącznie po udanym zapisie; retry po quocie działa.
2. **[ŚREDNI] Retry po nieudanym flush duplikuje wpis/działanie** (mutacja już w pamięci,
   formularz zostawał wypełniony). → NAPRAWIONE zmianą polityki: mutacja jest w bazie
   w pamięci i widoczna na liście, więc formularz czyścimy od razu; prawdę o trwałości
   mówi alert przy formularzu + stały banner (persistIssue) — bez ścieżki duplikatu.
3. **[DROBNY] initDb nierównoległościowe (StrictMode)** → NAPRAWIONE: memoizowana obietnica.
4. **[DROBNY] Wyciek połączeń IndexedDB** → NAPRAWIONE: jedno wspólne połączenie z cache.
