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

## 3. Hipotezy i selekcja (F2)

**Pula:** 79 hipotez (7 badaczy + kolider); pełny zrzut w journalu workflowu
`wf_580b1255-b6c` oraz w scratchpadzie sesji (`horizon-digest.md`).

**Kryteria (0–5):** oryginalność, wartość, „jak on to zrobił”, bezekranowość,
wykonalność-na-repo-w-tej-sesji, spięcie Android+EXE+elektronika, bezpieczeństwo,
mierzalność, demo-w-tej-sesji, trudność skopiowania.

**Ubój (≥85% → zostaje 10 z 79):** odrzucone m.in. bo (a) czysta integracja bez
nowej kategorii (H57–H61 „ANTY”, H03, H08, H20, H52), (b) wymaga fizycznego sprzętu
lub realnego buildu EXE z trayem, więc niedemonstrowalne uczciwie w sesji CI (H06,
H13, H21, H22, H26, H47, H55), (c) duplikat mocniejszej hipotezy (H43/H01/H10/H24/H62
→ scalone w „Sztafetę”; H09/H05/H30/H46/H72 → scalone w „Rejestr Dowodów”; H14/H41/H75
→ „Drabina Prawdy”), (d) zbyt szeroki zakres na jeden przekrój (H14 twin, H27, H48,
H54, H56 spektakle). Zachowany rdzeń (10): H01 Sztafeta Celów, H23/H12 MCP-everywhere
+ Fizyczny Aktuator, H75 Drabina Prawdy (read-back), H09 Rejestr Dowodów cross-device,
H76 Meldunek Trzech Kanałów, H11 Karta Przekazania (STOP), H37 Kontrakt Zgody Zakresowej
Głosem, H31 Strażnik nowej generacji, H33 Idempotentny rejestr wysyłek, H58 Emulator
jako PRAWDZIWY drugi koniec protokołu.

### Zwycięzca (synteza rdzenia): **Sztafeta Misji z Drabiną Prawdy**
Jeden trwały cel wędruje między węzłami (telefon / Windows EXE / urządzenie-emulator
mówiące protokołem MCP). Każdy krok wykonawczy przechodzi **drabinę prawdy**
SIMULATED → ATTEMPTED → CONFIRMED, gdzie CONFIRMED wymaga **odczytu zwrotnego** z węzła
(nie deklaracji). Wszystko spina **jeden rejestr dowodów** z `traceId` „od słowa do diody”;
twarde granice (hasło/płatność/MFA…) zamieniają się w **Kartę Przekazania** (STOP na EXE →
zatwierdzenie na telefonie), a wysyłki są **idempotentne** (correlationId, wyślij-raz).
Uczenie WYŁĄCZNIE z CONFIRMED (istniejący `learningLoop.canLearnFromOutcome`).

**Dlaczego to, a nie pojedyncza hipoteza:** archeolog udowodnił, że repo ma ~80%
fundamentów rozproszonych (goalState/goalRuntime/agentRun, ActionOutcome
DRAFT/SIMULATED/ATTEMPTED/CONFIRMED, permissions z `grantOutboundScope`, klient MCP
z fail-safe outbound, Strażnik-autopilot). Wynalazkiem jest **spięcie** ich w jedną
sztafetę z weryfikacją odczytem — czego żaden pojedynczy silnik dziś nie robi
(`resumableGoalsNewestFirst` bez konsumenta; EXE bez nasłuchu; sync bez celów/audytu).

### Uczciwa granica wykonalności w TEJ sesji (wg sceptyka + dyrektywy „nie twierdź, że
### przetestowano hardware”)
- **DZIAŁAJĄCE + PRZETESTOWANE:** silniki TS (sztafeta, drabina prawdy, rejestr dowodów,
  idempotencja, karta przekazania) + **emulator urządzenia jako PRAWDZIWY drugi koniec
  MCP** (moduł TS z tym samym adapterem, read-back potwierdzający stan) + testy Vitest.
- **SYMULOWANE (oznaczone):** fizyczny ESP32/RPi — emulator, nie sprzęt.
- **ZAPROJEKTOWANE, nie zbudowane w sesji:** kanał push telefon→PC (powiadomienia od komputera) — wymaga dalszej pracy.
  (Parowanie QR + podpis HMAC ORAZ kontrolowane wyjście loopback→LAN są już ZBUDOWANE
  i przetestowane — patrz 4b.) (Nasłuch EXE + tray + autostart są już ZBUDOWANE
  i testowane w Node/CI — patrz 4b.)
- **NIEUDOWODNIONE:** działanie na fizycznym Samsung S9 i realnym EXE użytkownika.

## 3b. Odrzucone hipotezy (skrót uzasadnień) — patrz wyżej „Ubój”.

## 4b. Zbudowany pionowy przekrój (F4) — DZIAŁAJĄCE + PRZETESTOWANE

Moduły (czyste silniki, `src/lib/horizon/`), spięte z istniejącym `ActionOutcome`:
- `types.ts` — Mission/MissionStep/StepResult/EvidenceEntry/HandoffCard/MissionState.
- `deviceEmulator.ts` — urządzenie mówiące protokołem MCP (kontrakt `tools/call`
  zgodny z `mcp.ts` `formatMcpResult`): `set_state`/`pulse` (ACK, bez „potwierdzam skutek")
  + `read_state` (ODCZYT ZWROTNY). Wstrzykiwana usterka i offline (test wyrwanej wtyczki).
- `truthLadder.ts` — `climbLadder`: SIMULATED (rehearsal) / FAILED (błąd) / CONFIRMED
  (tylko gdy read-back == expect) / ATTEMPTED (akcja OK, brak potwierdzenia).
- `evidenceLedger.ts` — append-only, jeden `traceId` na misję, idempotentny po
  (correlationId+state+stepId); `isCorrelationConfirmed` = „wyślij-raz"; `evidenceStory`.
- `handoff.ts` — twarde granice STOP (payment/publish/mfa…) → Karta Przekazania.
- `missionRelay.ts` — orkiestrator: idempotencja (CONFIRMED nie wykonuje się 2×),
  wyślij-raz, outbound bez auto-retry (FAILED/ATTEMPTED → pauza), STOP → awaiting_human.
- `deviceNode.ts` — adapter „device": akcja → read_state (ten sam adapter dla realnego
  ESP32/RPi, inny transport).

Dowód: `tests/horizonMissionRelay.test.ts` — **16 testów zielonych** (drabina prawdy,
sztafeta telefon→EXE→urządzenie, idempotencja+wznowienie po restarcie, test wyrwanej
wtyczki bez dubli, Karta Przekazania na płatności, rejestr dowodów, próba generalna).
Cztery bramki JARVIS-a: tsc czysto, ESLint czysto, Vitest 316/2724, build zielony.

- `mcpDevice.ts` — transport HTTP JSON-RPC (kontrakt `tools/call`) dla realnego
  ESP32/RPi/dowolnego serwera MCP: allowlista hostów fail-closed (zero sieci poza listą),
  timeout, walidacja kształtu odpowiedzi (śmieci nie udają odczytu zwrotnego), błędy jako
  `isError` (sztafeta widzi FAILED, nie wyjątek). Testowany przeciwko stubowi HTTP
  (`tests/horizonMcpDevice.test.ts`, 5 testów) — NIE przeciwko fizycznemu sprzętowi.

**Weryfikator (świeży kontekst, commit b7757b4): PRZEKRÓJ WIARYGODNY — 8/8 deklaracji
potwierdzonych sondami.** Znalezione przypadki brzegowe NAPRAWIONE z regresjami:
(B) kolizja correlationId między misjami dawała fantomowe CONFIRMED, a check wyślij-raz
stał przed checkiem STOP → teraz „wyślij-raz" zakresowane per misja i STOP sprawdzany
PRZED jakimkolwiek skrótem; (C) wisząca Karta Przekazania po nieudanym zatwierdzonym
kroku → karta żyje tylko w statusie awaiting_human; (D) rehearsal kroku STOP jest
celowo fail-closed (awaiting_human, nie ciche SIMULATED) — udokumentowane + regresja.
**Granica zaufania (A, nazwana wprost):** drabina prawdy ufa ODCZYTOWI ZWROTNEMU węzła —
read-back to nadal auto-raport urządzenia/EXE; węzeł umyślnie kłamiący w read_state może
sfałszować CONFIRMED. Obrona to podpisy/parowanie węzłów (zaprojektowane, nie zbudowane),
nie logika sztafety.

- `goalResume.ts` + wpięcie w proactive/App — **Kieszonkowa Ciągłość**: pierwszy konsument
  `resumableGoalsNewestFirst` (dotąd martwego); proaktywna OFERTA wznowienia celu po
  restarcie (cache IndexedDB→pamięć w ticku aplikacji, cooldown 6 h, tylko cele ≤7 dni,
  klik otwiera panel celu). Outbound dalej NIGDY nie wznawia się sam. 8 testów
  (`tests/goalResume.test.ts`) + wpis w changelogu.

- `handoffConsent.ts` + `permissions.askConsentUI` — **Karta Przekazania przez znaną
  bramkę zgód**: misja awaiting_human pyta przez ten sam PermissionDialog co narzędzia
  outbound, ale SUROWIEJ — zgoda zawsze jednorazowa („zapamiętaj" ignorowane), auto-zgoda
  Trybu Szefa i grantOutboundScope NIE omijają Karty, brak UI = misja czeka (fail-closed),
  każda decyzja w audycie. 6 testów (`tests/horizonHandoffConsent.test.ts`).

- `demoMission.ts` + `missionLog.ts` + narzędzia `mission_demo`/`mission_status` w tools.ts —
  **Sztafeta widoczna w produkcie** (głos/czat przez runTool = bramka zgód + audyt):
  pokaz dwuaktowy (usterka→pauza→wznowienie bez dubli) na emulatorze (jawna symulacja),
  status z łańcuchem dowodów; dziennik misji bounded w localStorage (10 misji/200 kwitów).
  Klasyfikacja ryzyka: status=read, demo=write (zero outbound). 4 testy
  (`tests/horizonMissionTools.test.ts`).

- `missionWhy.ts` + narzędzie `mission_why` — **czarna skrzynka bez ekranu**: `explainMission`
  wyjaśnia stan misji z FAKTÓW (potwierdzone kroki, powód pauzy: twarda granica / brak
  dowodu / usterka, ostatnie fakty łańcucha), wariant `voice` bez emoji dla TTS. Domyka
  „dlaczego?" z demo HORIZON. read (zero zapisu). 6 testów (`tests/horizonMissionWhy.test.ts`).

- `missionUndo.ts` + narzędzie `mission_undo` — **„Cofnij" w świecie fizycznym**: operacja
  odwrotna na węźle (przywróć stan sprzed kroku, zapamiętany jako `priorReadback` przez
  pre-read w deviceNode), potwierdzona odczytem zwrotnym; cofnięcie to NOWY kwit, nigdy
  kasowanie. Tylko kroki device odwracalne (nie hardStop); płatność/publikacja jawnie
  nieodwracalne; brak potwierdzenia → nie ogłasza cofnięcia. Domyka triadę bezekranową
  „dlaczego?/stop/cofnij". write (lokalne+emulator). 5 testów (`tests/horizonMissionUndo.test.ts`).

- `electron/horizon-listener-core.cjs` (czysty rdzeń) + `electron/horizon-listener.cjs`
  (transport) + `exeNode.ts` + narzędzie `mission_exe_probe` — **realny lokalny węzeł
  Windows EXE**: serwer HTTP nasłuchuje WYŁĄCZNIE na 127.0.0.1:4318, losowy token sesji,
  allowlista show_window/set_clipboard/read_state; próba EXE idzie przez uwierzytelniony
  HTTP-MCP i osiąga CONFIRMED dopiero po osobnym read_state windowVisible (ACK → ATTEMPTED).
  Tray utrzymuje proces po schowaniu okna; autostart jawnie opt-in; token tylko dla
  własnej ramki file:// przez IPC. Rdzeń testowany adwersarialnie (Vitest 11 testów:
  brak tokenu→401, obcy origin→403, narzędzie spoza allowlisty→403, zakaz bindu 0.0.0.0,
  ACK≠CONFIRMED, /health bez danych wrażliwych); wiring walidowany `node --check` + CI EXE build.

- `pairing.ts` (czysty, współdzielony) + wpięcie w `horizon-listener-core.cjs`/`.cjs` —
  **parowanie telefon↔EXE podpisem HMAC**: QR (adres+sekret) ustala sekret RAZ kanałem
  wizualnym; potem KAŻDE tools/call podpisane HMAC-SHA-256(secret, canonical) + ts + nonce.
  Sparowany węzeł odrzuca żądania bez podpisu (401), z podrobionym ciałem, z podmienionym
  podpisem, z powtórzonym nonce i ze starym ts (>5 min). Sekret nigdy w żądaniu; nonce
  „spalony" dopiero PO udanej weryfikacji. `canonicalString` identyczny po obu stronach
  (jedno źródło prawdy). 16 testów (`tests/horizonPairing.test.ts`, w tym weryfikacja
  wewnątrz rdzenia listenera prawdziwym podpisem). UCZCIWIE: warstwa integralności +
  anty-replay, NIE poufności (bez TLS); realne przejście loopback→LAN za świadomą zgodą
  = kolejny krok.

- `resolveBindPolicy`/`isPrivateLanAddress` (core) + `enableLan`/`disableLan` (transport) —
  **kontrolowane wyjście loopback→LAN za jawną zgodą**: bind startuje ZAWSZE na 127.0.0.1;
  LAN wymaga jednocześnie allowLan (jawna zgoda) + paired (HMAC obowiązkowy) + adresu
  PRYWATNEGO (RFC1918/link-local). 0.0.0.0, „*” i publiczny IP → NIGDY (nawet ze zgodą).
  enableLan rotuje token i czyści nonce; disableLan wraca na loopback (odwracalne). IPC
  horizon-pair/unpair/lan tylko dla własnej ramki. 8 testów (`tests/horizonLanPolicy.test.ts`,
  adwersarialne: publiczny IP / 0.0.0.0 / brak zgody / brak parowania — odrzucane).

- `MissionsPanel.tsx` (cienki) + wpięcie w `Mind.tsx` — **panel Sztafety w 🧠 Umyśle**:
  przyciski pokaz/status/dlaczego/cofnij + (desktop) próba węzła EXE; wynik w <pre> z
  łańcuchem dowodów. Cała logika w istniejących silnikach lib (te same, co głos/czat).
  Test ZACHOWANIA (createRoot+act, realne kliknięcia → prawdziwe silniki):
  `tests/missionsPanelBehavior.test.ts`, 5 asercji (start pusty, pokaz 3/3+dowody,
  dlaczego, cofnij, brak przycisku EXE poza desktopem).

- `deviceHealth.ts` (czysty) + `deviceHealthStore.ts` + narzędzie `mission_devices`
  + przycisk „🛡 Węzły" — **Strażnik węzłów (heartbeat floty)**: po każdym CONFIRMED węzła
  sztafeta bije heartbeat (callback `onNodeConfirmed` wstrzyknięty w czysty missionRelay);
  klasyfikacja healthy/delayed/dead z czasu od sygnału (warn 30 s / dead 90 s). ZASADA:
  martwy węzeł NIE wywołuje akcji — Strażnik raportuje i pozwala sztafecie się wstrzymać
  (zero cichych ponowień). 8 testów (`tests/horizonDeviceHealth.test.ts`, w tym integracja:
  pokaz bije heartbeaty → mission_devices je widzi).

**Granice uczciwości:** emulator = SYMULACJA sprzętu (nie fizyczny ESP32);
realny nasłuch EXE (tray/serwer) + kanał push telefon→PC = ZAPROJEKTOWANE, nie zbudowane;
działanie na fizycznym S9 i realnym EXE = NIEUDOWODNIONE.
**Następny bezpieczny krok:** wpięcie `deviceExecutor` w `mcp.ts` (device przez HTTP)
i konsument `resumableGoalsNewestFirst` (auto-wznowienie sztafety po restarcie).

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

**Etap:** F1b — WZNOWIONE (2026-07-02, na wyraźne „kontynuuj” użytkownika) po przerwie na
run KOMPAS (osobny kontrakt; produkt w `kompas/`, FAZA 6 zaakceptowana audytem, zamrożony).
Pierwszy bieg badaczy przerwał limit sesji: 3/8 skończyło (archeolog, futurysta, architekt
— wyniki w cache journalu `wf_580b1255-b6c`), 5 + kolider biegnie teraz z resume.
**Następny krok:** zebrać komplet wyników → F2 (≥50 hipotez, ubój ≥85%, punktacja, wybór).
**Dostarczone w międzyczasie:** raport FAZY 10 BESTII przekazany użytkownikowi w czacie
(CI 8/8 dla `5fffac7` potwierdzone).
**Uwaga o branchu:** commity KOMPAS-a (bd7d443…5d4a222) współdzielą branch — HORIZON
niczego w `kompas/` nie dotyka (kontrakt KOMPAS zabrania ulepszania po zielonej bramce).
