# PROJECT HORIZON — pamięć projektu

> Trwała pamięć robocza inicjatywy HORIZON: potwierdzone odkrycia, decyzje z uzasadnieniem,
> odrzucone hipotezy, pomiary, aktywne ryzyka i dokładny punkt wznowienia. Aktualizowana
> w miejscu (bez duplikatów). **Nie zawiera sekretów.** Prognozy i plany są oznaczone jako
> takie — wpis staje się „potwierdzony" dopiero z dowodem (test/commit/CI).

## 1. Potwierdzone odkrycia (z dowodem)

- **Stan repo na starcie HORIZON (2026-07-01):** drzewo robocze czyste, branch
  `claude/functionality-modification-access-z9kod1` zsynchronizowany z origin. Ostatnie commity:
  `5fffac7` (Dziennik Predykcji v2), `6201ee6` (5 invariantów uczciwości fundamentu).
  Dowód: `git status` / `git log` w sesji.
- **Zdalne CI dla `5fffac7`: 8/8 zielone** (Sales OS Gates, Sales OS build, Tests ×2,
  Build iOS, Build Windows EXE, Build Android APK, Release APK). Dowód: GitHub Actions,
  run https://github.com/Talent620/Jarvis/actions/runs/28553220942 i sąsiednie.
- **Naprawa przewijania czatu na S9+ już wdrożona:** `.convo` w `src/styles/index.css`
  (l. 600–610) ma `-webkit-overflow-scrolling: touch`, `touch-action: pan-y`,
  `overscroll-behavior: contain`, bez mask-image. Przeszła przez zielone CI.
- **Skala bazy kodu:** 261 modułów w `src/lib/`, ~70 komponentów, 315 plików testowych.
  Istnieją już: `guardian.ts`/`guardianAgents.ts`/`guardianHistory.ts` (Strażnik),
  `deviceControl.ts`, `desktop.ts` (Electron bridge), `permissions.ts`, `goalState.ts`/
  `goalRuntime.ts`/`goalGraph.ts` (cele trwałe), `agentRun.ts`, `recoveryPolicy.ts`,
  `selfHeal.ts`, `watchdog.ts`, `healthCheck.ts`, `resilience.ts`, `errorLog.ts`,
  `voiceLoop.ts`/`headset.ts`/`liveVoice.ts` (głos), `mcp.ts`, `n8n.ts`, `sync.ts`,
  `platformCapabilities.ts`, `capabilities.ts`. Elektron: `electron/main.cjs`,
  `google.cjs`, `smtp.cjs`, `preload.cjs`. Android: Capacitor (`android/`).

## 2. Decyzje (z uzasadnieniem)

- **D1 (2026-07-01):** HORIZON startuje od 8 równoległych badaczy ze ŚWIEŻYM kontekstem
  i RÓŻNYMI pytaniami (archeolog kodu, badacz przyszłych produktów, architekt
  Android+Windows+edge, inżynier niezawodności/błąd 500, projektant bezekranowości,
  modelarz zagrożeń, łowca przełomów, niezależny sceptyk) — zgodnie z dyrektywą HORIZON;
  wyniki wchodzą do puli ≥50 hipotez z ubojem ≥85%.
- **D2:** Zero resetów i cofania plików — praca wyłącznie addytywna na istniejącym stanie
  (dyrektywa użytkownika, potwierdzona czystym drzewem).

## 3. Odrzucone hipotezy

*(uzupełniane w F2 — na razie brak)*

## 4. Pomiary

- Bramki lokalne na `5fffac7`: tsc czysty, ESLint czysty, Vitest 315 plików / 2708 testów
  zielone, build produkcyjny zielony (zmierzono przed pushem; potwierdzone w CI).
- Benchmark Dziennika Predykcji: `docs/benchmarks/prediction-ledger.md` (scenariusz <50 ms,
  cykl 3000 leadów 26 ms, idempotencja 4 ms, kompakcja 18 ms).

## 5. Aktywne ryzyka

- **R1:** Zgłoszony przez użytkownika błąd 500 (Google/Gemini + druga funkcja równolegle)
  — nie zreprodukowany jeszcze w tej sesji; wymaga reprodukcji PRZED poprawką.
- **R2:** Cel S9/Chrome 79 (es2019, bez `\p{L}`, bez lookbehind) i pułapka cudzysłowów
  („ + prosty " psuje esbuild) — każda nowa linia kodu musi to respektować.
- **R3:** Brak fizycznego urządzenia elektroniki w sesji — protokół urządzeń wymaga
  emulatora + adaptera testowego i uczciwego oznaczenia „symulowane".

## 6. Punkt wznowienia

**Etap:** F1 — badacze uruchomieni (Workflow `wf_580b1255-b6c`, 8 agentów równolegle + kolider).
**Następny krok:** zebrać wyniki badaczy → F2 (≥50 hipotez, ubój ≥85%, punktacja, wybór).
**Zaległy artefakt do dostarczenia użytkownikowi:** raport FAZY 10 promptu BESTIA — NAPISANY
(CI 8/8 zielone — warunek spełniony); kopia w scratchpadzie sesji (`faza10-report.md`),
do wklejenia w raporcie końcowym HORIZON.
