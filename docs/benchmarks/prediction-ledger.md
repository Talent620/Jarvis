# Benchmark: Dziennik Predykcji (Prediction Ledger)

Data: 2026-07-01 · Scenariusz: **v2 (2026-07)** · Wykonawca pomiaru: `tests/predictionLedgerBenchmark.test.ts`
(bramka CI — każdy próg poniżej jest twardym progiem regresji) + `tests/predictionLedgerPerf.test.ts` (S9).

## Co mierzymy i dlaczego

Dziennik Predykcji zamyka pętlę: obserwacja → falsyfikowalna prognoza → działanie użytkownika →
realny wynik → deterministyczny werdykt (dowód OSOBNO od prognozy) → kalibracja per klient →
lepsza następna decyzja. Benchmark sprawdza tę pętlę na **produkcyjnym silniku**
(`runPredictionCycle` — dokładnie ta funkcja, którą woła cykl aplikacji), nie na atrapie.

## Baseline „przed zmianą"

Przed tą falą silnik nie istniał. JARVIS generował ostrzeżenia o zaniedbanych relacjach
(salesEngine/predict), ale **nikt nigdy nie sprawdzał po czasie, czy się sprawdziły**. Jedyny
uczciwy baseline: wszystkie metryki poniżej — *niemierzalne przed zmianą* (nie było czego mierzyć;
na pytanie „ile razy miałeś rację" JARVIS nie mógł odpowiedzieć niczym poza pustką — asercja
„baseline przed/po" w benchmarku).

## Scenariusz v2 (wersjonowany, deterministyczny ground truth)

10 anonimowych klientów × 90 dni, dzień po dniu, z **restartem aplikacji co dzień** (serializacja
JSON) i **każdym dniem liczonym dwukrotnie** (podwójny tick — wykrywa duplikaty). Dzień 14
globalnie pominięty (aplikacja zamknięta) — dzięki temu gałąź „kontakt spóźniony po terminie"
jest realnie osiągalna. Przypadki: reakcja po ostrzeżeniu (A), nigdy nie reaguje (B), wygrana (C)
i przegrana (D) w połowie okna, zero historii (E), kontakt dokładnie na terminie (F), godzinę po
terminie (G), czekająca płatność 8000 zł z Finansów (H), duplikat nazwy klienta B (I), lead
usunięty w trakcie (J). Ground truth spisany z góry per klient (`GROUND_TRUTH` w pliku testu).

## Wyniki „po zmianie" (2026-07-01, lokalny przebieg — te same progi pilnowane w CI)

| # | Metryka | Wynik | Próg regresji (CI) |
|---|---|---|---|
| 1 | Odsetek rozstrzygnięć zgodnych z ground truth | 10/10 klientów | wymagane 10/10 |
| 2 | False-positive rate (prevented bez realnego kontaktu w oknie) | 0 | wymagane 0 |
| 3 | Fałszywe „correct" (correct mimo kontaktu w oknie) | 0 | **wymagane 0 (twardy)** |
| 4 | Duplikaty rekordów / podwójne pending per klient | 0 | **wymagane 0 (twardy)** |
| 5 | Użycie nieaktualnego kontekstu (inputState/basis niezgodne z danymi w chwili prognozy) | 0 | wymagane 0 |
| 6 | Poprawność zgód (narzędzie czatu `read`, zero zapisu leads/finance) | ✓ | wymagane |
| 7 | Zachowanie offline (zatruty `fetch`, zero wywołań sieci/modelu) | ✓ | wymagane |
| 8 | Czas: pełny scenariusz (10 kl. × 90 dni, restarty, 2× cykle) | < 50 ms lokalnie | < 250 ms |
| 9 | Stabilność na dużej liczbie: cykl 3000 leadów / 600 prognoz | 26 ms lokalnie | < 300 ms |
|   | — cykl idempotentny (bez zmian) na tym samym stanie | 4 ms lokalnie | < 150 ms |
|   | — kompakcja dziennika 5000 rekordów | 18 ms lokalnie | < 150 ms |
| 10 | Kalibracja: prognozy o wysokiej pewności trafniejsze niż o niskiej | ✓ (acc(≥0.75) > acc(≤0.65)) | wymagane |
|    | — pewność dla klienta ignorującego ostrzeżenia ROŚNIE (>0.70), dla reagującego SPADA (<0.70) | ✓ | wymagane |

Pomiary czasu wykonano na maszynie CI-podobnej (kontener x86); Samsung S9 będzie wolniejszy —
stąd progi z ~10-krotnym zapasem względem zmierzonych wartości.

## Świadomie NIEZMIERZONE (bez podstawiania sztucznych liczb)

- **Koszt tokenów modelu** — silnik z konstrukcji nie woła żadnego modelu (koszt 0, potwierdzone
  zatrutym `fetch`), więc „koszt inferencji" nie istnieje jako metryka.
- **Realny wpływ biznesowy** (czy prognozy uratowały relację/płatność) — wymaga tygodni
  prawdziwego użycia na realnych klientach; nie da się tego uczciwie zmierzyć w CI. Zamiast
  liczby: mechanizm pomiaru istnieje (każda prognoza rozstrzyga się sama), wynik pojawi się
  u użytkownika w 🧠 Umysł → Prognozy.

## Scenariusze adwersarialne (poza benchmarkiem, `tests/predictionLedgerAdversarial.test.ts`)

Kontakt z przyszłości, dane poprawione wstecz (sprzeczne źródła), cofnięty zegar (zamknięta
prognoza nieodwracalna; świeża nie dostaje „correct" przed terminem), zmiana statusu w połowie
okna, duplikaty nazw w CRM (narzędzie czatu odmawia zgadywania), model nie ma ścieżki zapisu do
dziennika, użytkownik kwestionuje dowód (werdykt wypada z uczenia → NASTĘPNA decyzja wraca do
domyślnych), czyszczenie historii zeruje uczenie, 2 i 300 próbek uczenia w twardych granicach,
częściowa wpłata nie zeruje stawki prognozy.
