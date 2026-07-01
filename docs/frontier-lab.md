# Frontier Lab — mapa ukrytego potencjału JARVISA

Data: 2026-07-01. Metoda: bezpośrednie czytanie kodu (Read/Grep), nie zgadywanie. Każde
twierdzenie poniżej ma dowód (plik:linia) albo jest jawnie oznaczone jako niezweryfikowane.

## 0. Kontekst

Repo ma ~259 plików w `src/lib/*.ts`. Wiele z nich to samodzielne, czyste "silniki"
(funkcje bez efektów ubocznych, w pełni testowalne). Cel tej mapy: znaleźć silniki, które
**istnieją, są dobrze zbudowane, ale nie mają konsumentów** — oraz miejsca, gdzie dwa lub
więcej silników mogłyby się połączyć w coś, czego dziś nie ma.

## 1. Silniki istniejące, ale bez realnych konsumentów produkcyjnych

### 1.1 `src/lib/decisionEngine.ts` — Rada Strategiczna (Strateg → Krytyk → Sędzia)
**NAJWAŻNIEJSZE ZNALEZISKO.** Kompletny, przetestowany silnik adwersarialnej deliberacji:
- `runDecisionCouncil(input, runner)` (decisionEngine.ts:150) — trzy role po kolei,
  zwraca `{ recommendation, alternatives, risks, reversibility, firstSafeStep, confidence, ranBy, note }`.
- `isHighStakes(input)` (decisionEngine.ts:47) — wykrywa wysoką stawkę (kwota ≥1000 zł
  LUB nieodwracalność).
- `inferReversibility(input)` (decisionEngine.ts:38) — wykrywa nieodwracalne słowa-klucze
  ("wyślij", "zapłać", "usuń", "podpisz"...).
- `shouldRunDecisionCouncil(opts)` (decisionEngine.ts:55) — **JUŻ ISTNIEJE logika
  auto-wyzwalania** dla trybu "maximum" przy wysokiej stawce.
- `council.ts:204` `decideWithCouncil(input, runner)` — gotowy wrapper z domyślnym
  `makeProviderRoleRunner()`.

Dowód braku konsumenta: `grep -rn "decideWithCouncil" src/` → **tylko `council.ts` samo
siebie**. `grep -rn "runDecisionCouncil" src/` → tylko `council.ts` (re-eksport) i
`tests/decisionEngine.test.ts`/`tests/cognitiveOrganism.test.ts` (testy). App.tsx/brain.ts
NIGDY tego nie wołają. Istniejący w App.tsx "⚖ Konsylium" (guzik, `askCouncil` w
`council.ts:115`) to **INNY, prostszy mechanizm** — pyta N modeli równolegle o tę samą
odpowiedź i syntetyzuje konsensus. To NIE jest adwersarialna rola Strateg/Krytyk/Sędzia.

Innymi słowy: JARVIS ma gotowy, przetestowany system "zakwestionuj własny pierwszy
pomysł przy ważnej decyzji" — i nigdy go nie używa przy żadnej prawdziwej decyzji.

### 1.2 `src/lib/predict.ts` — silnik predykcyjny
`predict(input, now)` (predict.ts:36) generuje przewidywania 7 rodzajów, w tym
`relationship` (predict.ts:83-87): "osoba znana (≥3 wzmianki w world modelu),
niewspominana od ≥30 dni" → ostrzeżenie o zaniedbanej relacji.

Konsument: `chiefOfStaff.ts` (przez `predict()`), wpięty w `tools.ts`
(`chief_of_staff`, read), `App.tsx`, `Mind.tsx`, `proactiveNotify.ts` — **JEST żywy**.

Ograniczenie: próg 30 dni jest **globalny i stały dla każdej osoby**. Nie ma pojęcia
"dla klienta X normalny odstęp kontaktu to 3 dni, dla znajomego Y — 2 miesiące". Zero
uczenia się z tego, co faktycznie działa u KONKRETNEJ osoby.

### 1.3 `src/lib/worldModel.ts` — trwały graf encji/relacji
`recordWorld()`/`getWorld()`/`recallEntities()` (worldModel.ts:101,122,127) — żywy,
wpięty w `brain.ts` (po każdej wymianie) i `tools.ts` (`world_recall`, read), UI w
`Mind.tsx`. Śledzi `mentions`/`lastSeen`/`confidence` per encja. **Czysto opisowy** —
nie przewiduje konsekwencji, nie proponuje eksperymentów, nie ma pamięci "co się stało,
gdy ostatnio zignorowałem/zadziałałem".

### 1.4 `src/lib/contextFusion.ts` — "Szósty Zmysł"
Żywy (brain.ts, NeuralInterface.tsx) — rankuje "otwarte wątki" (zadania, przypomnienia,
projekty, leady, kalendarz, tematy nawracające) względem BIEŻĄCEGO zapytania czatu.
Karmi TYLKO prompt czatu — nie karmi żadnej decyzji biznesowej ani rekomendacji dnia.

### 1.5 `src/lib/growthOrchestrator.ts` — uczenie z akceptacji/odrzucenia
`recordDecision(weights, kind, accepted)` (growthOrchestrator.ts:127) jest **żywy**:
`GrowthDayPanel.tsx:70,81` woła go przy akceptacji/odrzuceniu rekomendacji dnia.

Krytyczne ograniczenie (zweryfikowane): uczenie jest **per RODZAJ akcji globalnie**
(`send_followup`, `publish_post`...), NIE per KONKRETNY klient/lead. I uczy się z tego,
czy Marcin **kliknął akceptuj**, NIE z tego, czy akcja faktycznie **zadziałała**
(klient odpowiedział, płatność wpłynęła, post przyniósł ruch). To pętla zamknięta na
poziomie "czy mu się podobała sugestia", NIE na poziomie "czy sugestia dała rezultat".

### 1.6 `src/lib/actionOutcome.ts` — dowód wykonania
Solidny fundament uczciwości (DRAFT→SIMULATED→ATTEMPTED→CONFIRMED→FAILED,
`canClaimSuccess()`), żywy w wielu miejscach. Brak: nic nie ŁĄCZY konkretnego
CONFIRMED wyniku z wcześniejszą PREDYKCJĄ, żeby sprawdzić, czy predykcja była trafna.

## 2. Główna luka (cross-cutting gap)

Żaden istniejący silnik nie zamyka pętli:
**sygnał o ryzyku/szansie → poważna deliberacja (mamy to! decisionEngine, nieużywany)
→ jeden konkretny, mierzalny mikro-eksperyment → zgoda → wykonanie → dowód (mamy to!
actionOutcome) → SPRAWDZENIE PO CZASIE, czy przewidywanie się sprawdziło → aktualizacja
zachowania SPECYFICZNIE dla tej osoby/klienta (nie globalnie).**

`recordDecision` zamyka namiastkę tej pętli, ale (a) tylko per-kind, nie per-entity,
(b) tylko "czy kliknięto", nie "czy zadziałało". `predict.ts`'s próg 30-dniowy dla
zaniedbanych relacji jest identyczny dla każdej osoby — mimo że `worldModel.ts` już
zna `mentions`/`lastSeen` per osoba, a `salesEngine.ts`'s `relationshipStatus()`
(salesEngine.ts:166, dodane w poprzedniej fali) już zna per-lead ostatni kontakt.

## 3. Proaktywność w App.tsx (przegląd pobieżny — do weryfikacji przy budowie)

App.tsx ma wiele niezależnych `useEffect` z timerami (dymki-porady, przypomnienia,
follow-upy, world model itd.) — każdy działa **osobno**, bez współdzielonego licznika
"ile już dziś pokazałem użytkownikowi". To osobne ryzyko (nie centralny temat tej fali),
odnotowane do ewentualnej przyszłej pracy.

## 4. 30 hipotez pionierskich (każda łączy ≥3 obszary) i werdykt

1. **Per-encja uczona kadencja kontaktu** (worldModel+predict+CRM+uczenie) — zamiast
   globalnego "30 dni", uczyć się per-osoba/klient, jaki odstęp faktycznie oznacza
   zaniedbanie, z realnej historii kontaktów i reakcji. **PRZEŻYWA.**
2. **Rada Strategiczna wpięta w realne decyzje** (decisionEngine+finance+consent) —
   `decisionEngine.ts` istnieje, jest przetestowany, ma ZERO konsumentów. **PRZEŻYWA.**
3. **Dziennik predykcji z weryfikacją po czasie** (actionOutcome+predict+uczenie) —
   JARVIS zapisuje "przewiduję X", potem sprawdza, czy się sprawdziło, i szczerze
   pokazuje swoją celność. **PRZEŻYWA — to jest brakujący klej między 1 i 2.**
4. Wykrywacz niewypowiedzianych zobowiązań z rozmów bez pokrycia w kalendarzu/zadaniach
   — realny pomysł, ale w praktyce podzbiór #3 (obietnica = predykcja "coś zrobię").
   **ZABITA (scal z #3).**
5. Konflikt cel-deklarowany vs zachowanie realne (goalGraph+usage+finance) — ciekawe,
   ale wymaga nowej klasyfikacji "czas = który cel" z danych, których dziś nie zbieramy
   wystarczająco precyzyjnie (usage.ts śledzi kliknięcia ekranów, nie czas pracy per
   klient). **ZABITA (zbyt duża nowa infrastruktura na tę falę).**
6. Pamięć kontrfaktyczna z `alternatives` Rady Strategicznej vs realny wynik — mocna,
   ale to w istocie ROZSZERZENIE #3 (bez #2/#3 nie ma czego porównywać).
   **ZABITA (wchłonięta przez #2+#3).**
7. Autonomiczne, obwarowane eksperymenty biznesowe — potrzebuje #1-3 jako fundamentu
   najpierw. **ODŁOŻONA (naturalny kolejny krok po zbudowaniu #1-3, nie w tej fali).**
8. Nauka najlepszego momentu/kanału interwencji per-osoba — ciekawa, ale usage.ts dziś
   śledzi tylko KTÓRE ekrany, nie WYNIK interwencji. Bez #3 (dziennika wyników) nie ma
   z czego się uczyć. **ZABITA (zależna od #3, osobna oś danych).**
9. Health-score relacji z klientem (CRM+finanse+pamięć) — mocno pokrywa się z istniejącym
   `salesEngine.relationshipStatus` (dodanym poprzednią falą). **ZABITA (przyrostowa,
   nie pionierska — realny pomysł na kolejną, mniejszą iterację).**
10. Emocjonalny dryf tonu głosu — brak infrastruktury sentymentu głosu. **ZABITA
    (zbyt spekulacyjna, zero danych źródłowych dziś).**
11. Automatyczny tracker obietnic ze spotkań kalendarzowych — mała dźwignia, głównie
    manualny nawyk. **ZABITA (niska wartość, słaba nowość).**
12. Cichy predyktor odpływu klienta z rozkładu częstotliwości kontaktu — pokrywa się
    z #1 (to właściwie to samo pytanie od drugiej strony). **SCALONA Z #1.**
13. "Co by pomyślało przyszłe ja" — czysty trik promptowy, nie architektura.
    **ZABITA (brak substancji technicznej).**
14. Wąskie gardło czasowe z kalendarza+finansów+leadów — JUŻ ISTNIEJE
    (`businessSimulator.biggestRevenueBlocker`, wykrywa "brak czasu"). **ZABITA (duplikat).**
15. Uczenie się najlepszej TREŚCI follow-upu (nie tylko czasu) z realnych odpowiedzi
    mailowych — wymaga śledzenia odpowiedzi na maile (nowa integracja czytania skrzynki
    pod kątem odpowiedzi), zbyt duża nowa infrastruktura na jeden pionowy wycinek.
    **ODŁOŻONA.**
16. "Adwokat diabła przed wysłaniem" — auto-Rada dla KAŻDEGO wychodzącego maila wysokiej
    stawki — to węższe okno #2 (Rada wpięta w konkretny punkt: `gmail_send`).
    **SCALONA Z #2 (jako jeden z punktów wejścia).**
17. Kalkulator kosztu zwłoki ($/dzień opóźnienia) — rozszerzenie finance.ts, umiarkowana
    nowość. **ODŁOŻONA (dobra, ale mniejsza, samodzielna funkcja na inną falę).**
18. Detektor osobistego "młotka na każdy gwóźdź" (ten sam schemat rozwiązań niezależnie
    od problemu) — wymaga klasyfikacji wzorców w setkach rozmów, wysokie ryzyko
    badawcze. **ZABITA (zbyt niepewna na jedną falę).**
19. Wczesne ostrzeżenie o wypaleniu z zaległości+dziennika — wymaga analizy sentymentu
    dziennika (nie istnieje). **ODŁOŻONA.**
20. "JARVIS pamięta, jakiej rady udzielił i czy się do niej zastosowałeś" — to dosłownie
    #3 innymi słowami. **SCALONA Z #3.**
21. Coach negocjacji cen z realnych zaakceptowanych/odrzuconych ofert — brak dziś
    ledgeru akceptacji/odrzucenia ofert (mamy tylko draft/wysłane). **ODŁOŻONA (nowa
    oś danych, osobny temat).**
22. Rozwiązywacz sprzeczności pamięć+world model+notatki — `contextCurator.curateContext`
    JUŻ wykrywa sprzeczności. **ZABITA (duplikat, przyrostowa co najwyżej).**
23. ROI inwestycji w relację (wartość historyczna × ryzyko zaniedbania → priorytet
    "z kim się dziś skontaktować") — mocna, ale to WARSTWA PRIORYTETYZACJI nad #1,
    nie osobny silnik. **SCALONA Z #1 (jako ranking wyjściowy).**
24. Nakładka emocjonalna na ton głosu w Trybie Szefa — brak infrastruktury.
    **ZABITA.**
25. Auto-cotygodniowe podsumowanie: co przewidziałem, co się stało, co koryguję —
    to WARSTWA RAPORTOWANIA nad #3, nie osobny silnik. **SCALONA Z #3.**
26. Sprawdzenie wag ICP (leadScoring) względem realnych won/lost — JUŻ ISTNIEJE
    (`learnWeightsFromOutcome`, wpięte w `SalesDashboard.tsx:286`). **ZABITA (duplikat
    potwierdzony w kodzie).**
27. Multimodalne "przeczytaj pokój" z dokumentów+CRM — ciężka nowa infrastruktura.
    **ZABITA.**
28. Autonomiczne małe testy A/B treści ofert przez campaignEngine+campaignRoi — pętla
    ROI dla marketingu już istnieje; CRM/relacje to niedoinwestowany obszar, nie
    marketing. **ODŁOŻONA (marketing ma już swoją pętlę).**
29. Sprawdzacz cichych założeń przed uruchomieniem Rady — szczegół IMPLEMENTACYJNY
    Rady (businessSimulator już ma pole `assumptions[]`), nie osobny pomysł.
    **WCHŁONIĘTA jako wymóg implementacyjny #2/#3.**
30. Osobisty dziennik decyzji z retrospektywną celnością ("JARVIS miał rację w X% ważnych
    rozmów") — to jest DOKŁADNIE #3 nazwane od strony miary sukcesu. **SCALONA Z #3.**

**Wynik selekcji: z 30 hipotez przeżywają 3 (10%), reszta zabita/odłożona/scalona —
próg 80% zabicia osiągnięty i przekroczony.**

## 5. Ocena 3 finalistów (0–10 na wymiar)

| # | Koncepcja | Nowość | Wartość | Wykonalność | Przewaga z danych | Mierzalność | Bezpieczeństwo | "Skąd wiedział?!" |
|---|---|---|---|---|---|---|---|---|
| 1 | Uczona kadencja kontaktu per-encja | 6 | 7 | 7 | 8 | 6 | 8 | 6 |
| 2 | Rada Strategiczna wpięta w realne decyzje | 5 | 7 | 8 | 6 | 5 | 7 | 5 |
| 3 | Dziennik predykcji z weryfikacją po czasie | 8 | 8 | 7 | 9 | 9 | 8 | 8 |

Uzasadnienie #3 jako klej łączący 1+2: sam w sobie #1 (kadencja) i #2 (Rada) to dwie
NIEZALEŻNE, umiarkowanie ciekawe funkcje. #3 (Dziennik predykcji z weryfikacją) to
**substrat, który zamienia KAŻDĄ istniejącą predykcję/rekomendację JARVISA (nie tylko
kadencję kontaktu) w coś, co samo siebie sprawdza i koryguje** — a to jest dokładnie
luka opisana w sekcji 2 mapy, i dokładnie to, czego nie znalazłem u konkurencji (research
w sekcji 6). Buduje najwyższy iloczyn nowość×wartość×przewaga×mierzalność / koszt.

## 6. Research odpowiedników (uczciwy, z próbą obalenia własnej tezy)

Szukane frazy (WebSearch, lipiec 2026):
- "personal CRM app that predicts relationship neglect and verifies prediction against
  actual outcome later" — trafienia: Dex, Clay, Monica, BigContacts i podobne —
  wszystkie robią PRZYPOMNIENIA wg stałego interwału ("odezwij się co 30 dni"), ŻADEN
  nie znaleziony wynik nie opisuje uczenia się per-kontakt ani porównania predykcji z
  realnym wynikiem.
- "AI personal assistant that logs its own predictions and checks accuracy later
  calibration track record 2026" — trafienia: ogólne omówienia asystentów AI 2026,
  dyskusja o "AI accuracy"/"data-drift alerts" w kontekście People Analytics dla firm —
  ŻADEN wynik nie opisuje asystenta OSOBISTEGO z własnym dziennikiem celności predykcji
  per-użytkownik.
- Próba obalenia: enterprise "forecasting accuracy monitoring" / "prediction-distribution
  dashboards" istnieją dla dużych firm (People Analytics) — to dowód, że KONCEPCJA
  kalibracji predykcji nie jest sama w sobie nowa dla świata ML/BI. Nowość JARVISA nie
  jest w idei "mierz celność predykcji" (to znane w BI/ML), tylko w POŁĄCZENIU: lokalny,
  prywatny, per-osobisty ślad kalibracji WPIĘTY w konkretne, codzienne, niskiej-stawki
  decyzje jednego solo-przedsiębiorcy, zasilany już istniejącym w repo world modelem i
  silnikiem CRM — bez wysyłania niczego do chmury dostawcy BI.

**Uczciwe zastrzeżenie:** nie znalazłem publicznego odpowiednika po sprawdzeniu
dostępnych przez WebSearch źródeł (osobiste CRM, ogólne omówienia asystentów AI 2026).
To NIE jest twierdzenie "tego nie ma nigdzie" — może istnieć niszowy startup/projekt
badawczy, którego nie złapało wyszukiwanie. Klasyfikacja: **potencjalnie pionierskie
POŁĄCZENIE** (dziennik kalibracji predykcji + lokalny, prywatny CRM/world model
solo-przedsiębiorcy), a nie pionierska koncepcja kalibracji predykcji per se (ta
istnieje w BI/ML od dawna, po prostu nie w tej formie/kontekście).

## 7. Zwycięska koncepcja: **Dziennik Predykcji (Prediction Ledger)**

Silnik, który dodaje jedną nową, brakującą zdolność: gdy JARVIS przewiduje coś
konkretnego i sprawdzalnego o kliencie ("bez kontaktu w ciągu N dni ta relacja ostygnie"),
zapisuje to jako FALSYFIKOWALNĄ prognozę z terminem. Gdy termin nadchodzi, JARVIS porównuje
przewidywanie z tym, co faktycznie się stało, i szczerze aktualizuje per-klient pewność —
a Marcin w każdej chwili może zapytać "ile razy miałeś rację?" i dostać PRAWDZIWĄ odpowiedź.

## 8. Jak to FAKTYCZNIE zaimplementowano (v2 — stan kodu, nie plan)

Uczciwa korekta względem pierwotnego szkicu z sekcji 7: źródłem sygnału NIE jest `predict.ts`
(30-dniowy, globalny próg world-modelu), tylko `salesEngine.relationshipStatus()` — bo to on zna
REALNĄ kadencję follow-upów per lead. `worldModel` nie bierze udziału w tej pętli (odnotowane,
żeby nie twierdzić więcej, niż zrobiono).

Realnie połączone systemy (każdy ZMIENIA prognozę/działanie/ocenę — nie sam import):
1. **CRM/salesEngine** — `lastContactedAt`/`status`/kadencja follow-upu tworzą prognozę i
   rozstrzygają ją po terminie (`predictionCycle.ts` → `runPredictionCycle`).
2. **Finanse** — projekt czekający na płatność (po `leadId`) SKRACA okno prognozy o 2 dni i
   dokłada jawną przesłankę „zaniedbanie kosztuje realne pieniądze" (kwota w `inputState`).
3. **Agent proaktywny** — cykl aplikacji (tick ~90 s + pierwszy przebieg po starcie) uruchamia
   przetwarzanie NIEZALEŻNIE od otwierania teczki; nudge `predictions` (cooldown 6 h) ogłasza
   świeżą prognozę / sprawdzone ostrzeżenie.
4. **Czat/głos** — `prediction_ledger_status` (read; przy duplikatach nazw odmawia zgadywania).
5. **UI** — LeadDetail (tylko WYŚWIETLA), 🧠 Umysł → sekcja Prognozy (podgląd, „dowód błędny",
   wyłącznik uczenia, czyszczenie historii).

Twarde zasady w schemacie (`src/types.ts`): prognoza jest niemutowalna po utworzeniu
(zamrożony `inputState`, `claim`, `successCriterion`, `checkAt`, `confidence`, `assumptions`,
`sources`, `logicVersion`); DOWÓD (`PredictionEvidence`: observedAt/outcome/evidence/verdict/
reason/confidenceAfterResolution) zapisywany OSOBNO, dokładnie raz, przez deterministyczną
regułę — model językowy nie ma ścieżki zapisu. Uczenie (okno per klient + kalibracja pewności
EWMA) ma minimum obserwacji (2), ograniczony krok, twarde granice, wyłącznik i zerowanie.

Dowody: `tests/predictionLedger.test.ts` (48), `tests/predictionLedgerBenchmark.test.ts`
(11, ground truth + progi regresji), `tests/predictionLedgerAdversarial.test.ts` (17),
`tests/predictionBehavior.test.ts` (12, realne komponenty + kliknięcia),
`tests/predictionLedgerPerf.test.ts` (5, tysiące rekordów). Raport benchmarku:
`docs/benchmarks/prediction-ledger.md`.
