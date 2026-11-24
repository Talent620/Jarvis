# JARVIS — SYSTEM X-RAY REPORT

> Pełny audyt enumeracyjny systemu (read-only). Każdy podsystem przeskanowany element-po-elemencie
> przez dedykowanych agentów; poniżej synteza globalna + kluczowe ustalenia per-klaster.
> Metoda: 10 równoległych audytów pokrywających ~315 plików (`src/`, `proxy/`, `electron/`, `android/`, CI, config).
> Data: 2026-06. Status: analiza — bez zmian w kodzie w momencie powstania raportu.

---

## 0. OVERALL SYSTEM SCORE

| Wymiar | Ocena | Uzasadnienie |
|---|---|---|
| **Architecture** | **6/10** | Mocny rdzeń (failover, store, persystencja, providery, pipeline głosu); w dół ciągną god-components i klaster feature-creep |
| **Clarity** | **6/10** | Świetne komentarze + pure functions; psują monster-files i mylące nazwy (prompts, brainMode/brainModes, context/contextFusion, followups) |
| **Modularity** | **5.5/10** | Dobra warstwa lib; App.tsx/Settings.tsx jako god-components, 38-propowy More, 4× boilerplate workerów |
| **Maintainability** | **4.5/10** | Najsłabsze — masa nakładających się silników, 3 osierocone moduły, realny bug kolizji klucza, lustra list narzędzi |
| **Consistency** | **5/10** | Niespójne: auth BFF, trwałość, zapis ustawień, i18n (aspiracyjne), white-label |
| **🎯 CAŁOŚĆ** | **~5.5/10** | Bogaty funkcjonalnie, runtime-stabilny, ale strukturalnie przeładowany |

---

## 1. SYSTEM SUMMARY — jak naprawdę działa JARVIS

JARVIS to dojrzały, wieloplatformowy asystent AI (PWA + Android/iOS via Capacitor + Windows EXE via Electron) z backendem-for-frontend na Cloudflare Workers (`proxy/worker.js`). Sercem jest `brain.ts` — buduje system-prompt (persona + 5 warstw pamięci) i prowadzi pętlę AI z **najlepszą-w-klasie warstwą odporności**: circuit breaker, rotacja kluczy, failover dostawców, lokalny ogon (Ollama/WebLLM) oraz opcjonalna warstwa on-device (WebGPU/WASM: embeddingi, Whisper STT, Kokoro TTS, WebLLM). Store w RAM + IndexedDB (`db.ts`), reaktywny przez licznik wersji (`useStore`/`useSyncExternalStore`).

**Mocne strony**: odporność i fallbacki (wzorowe), warstwa providerów, pipeline STT/TTS, hardening importu kopii, poprawna kryptografia (AES-256-GCM/PBKDF2), samoleczenie UI (`ErrorBoundary`/`ScreenBoundary`), ogrom przemyślanych pure-functions.

**Ukryte problemy**: (1) ~30% kodu to nakładające się lub osierocone podsystemy; (2) feature-creep poza rdzeń asystenta (puls z kamery, growth-hacking, Anki, dziennik, „IQ" z 6 pytań); (3) god-components (App.tsx 1591 l., Settings.tsx 2915 l.); (4) realne długi bezpieczeństwa (keystore w repo, dziurawa brama zgód, fail-open BFF, kolizja klucza localStorage).

---

## 2. SPECIAL FOCUS — kluczowe ustalenia

### 🧠 System prompt (`brain.ts:198-315`)
- Tożsamość zaszyta na sztywno: *„Jesteś JARVIS — autonomiczny asystent w stylu Tony'ego Starka"*.
- Zwraca się do użytkownika przez `userName` (interpolacja). **Brak** hardcoded „Szef"/„Sir" w prompcie czatu — „Szef" żyje tylko w UI. Wyjątek: `council.ts:116` fallback „Sir".
- Język wymuszony POLSKI. Persona domyślna: „brytyjski majordomus". Charakter mocno agentowy.
- ⚠️ **White-label złamany**: `brand()` jest tylko w UI — nigdy nie trafia do promptu.
- ⚠️ **Konsylium ma inną osobowość**: `council.ts` ma własny prompt + fallback „Sir" + brak narzędzi.
- ⚠️ **Dwa równoległe systemy tonu**: PERSONAS vs `conversationStyleDirectives` (warmth/length).

### 💾 Pamięć (5 podsystemów)
Semantyczna lokalna (`memory.ts` + `memoryScore` + `rag`) · chmurowa Mem0/Qdrant (`memoryService.ts`, namespace personal/business) · epizodyczna (`episodicMemory.ts`) · „szósty zmysł" (`contextFusion.ts`) · graf encji (`worldModel.ts`). Plus `recall.ts` (wyszukiwarka UI, nie wstrzykiwana). Dobrze rozdzielone osiowo, ale podwójny koszt tokenów (lokalna + Mem0) i bug kolizji klucza.

### 🤖 Agenci — reality check
Tylko **`goalPlanner`** (realny DAG + `orchestrator`) i **pętla Boss/Conversation** są faktycznie agentowe. „6 agentów Guardiana" to — uczciwie przyznane w nagłówku pliku — heurystyczne generatory raportów nad jednym snapshotem skanu.

### 🛟 Fallbacki / obsługa błędów — NAJMOCNIEJSZA strona
Wszędzie capability-check + graceful degradation, kaskady TTS/STT, circuit breaker + rotacja kluczy + lokalny ogon, samoleczenie UI. Dojrzałe i przemyślane. **Do zachowania bez naruszeń.**

---

## 3. CONSISTENCY CHECK (widok globalny)

Na poziomie pojedynczych `lib/*` system jest czysty i testowalny. Problem to **nakładające się podsystemy** i **niespójne konwencje przekrojowe**.

### Nakładające się silniki (ten sam cel, wiele implementacji)
| Domena | Ile | Pliki |
|---|---|---|
| „Popraw odpowiedź dodatkowym przebiegiem" | 5 | speculative, localConsensus, localRefine, verify, council |
| Detektor złożoności zapytania | 3 | `isComplex` (aiHelpers), `classifyTask`, `needsDeepThink` (modelRouter) |
| „Przeskanuj system i oceń" | 4 | healthScore, aggregateHealth, computeFitness, analyzePerformance |
| „Sprawdź wszystko" (status) | 3-4 | healthCheck, diagnostics, guardianAgents, guardian.diagnose |
| Silnik proaktywny | 3 | predict, proactive, proactivity |
| Silnik briefingu | 2 | dailyBriefing, chiefOfStaff (oba „Chief of Staff") |
| Pętla rozmowy głosowej | 2 | voiceLoop vs smartConversation |
| Lista narzędzi (lustra) | 3 | RISK map, LABELS (PermissionDialog), capabilitiesDigest |
| Konfiguracja dostawcy | 3 | registry, TASK_MODELS (brain), FREE_PROVIDERS (freeMode) |
| Ring-buffer localStorage | 5 | guardianHistory, bossMemory, iqProbe, habit, tips |
| Boilerplate managera workera | 4 | localTts, localWhisper, localEmbed, webllm |

### Niespójne konwencje przekrojowe
- **Auth BFF**: fail-open (`appTokenBad`) vs fail-closed (`adminOk`) vs „obecność Bearera" (smtp) vs „token = klucz KV" (sync).
- **Trwałość**: wprowadzono IndexedDB (`db.ts`), ale `episodicMemory`/`usage` nadal piszą wprost do localStorage.
- **Zapis ustawień**: część natychmiast (klucze/głos/język/motyw), część dopiero po „Zapisz".
- **i18n**: `i18n.ts` ma 11 kluczy, używany w ~1 ekranie; reszta to ~99% zaszytego polskiego.
- **Latche jednorazowe**: `embedDisabled`/`everFailed` nie odzyskują w sesji.

---

## 4. KEY ISSUES — realne problemy (nie tylko zapachy)

### 🔴 Krytyczne
1. **Kolizja klucza localStorage**: `usage.ts` i `usageTelemetry.ts` używają tego samego `"jarvis.usage.v1"` z niekompatybilnymi schematami → wzajemna korupcja; `resetAdaptive()` kasuje telemetrię kosztów.
2. **Keystore w repo**: `android/keystore/jarvis.jks` + hasła na sztywno (`jarvis2026`) zacommitowane (komentarz przyznaje wcześniejszy wyciek). + stary `JARVIS (1).apk`. **Uwaga: rotacja klucza jest nieodwracalna wobec Sklepu Play; usunięcie z historii wymaga rewrite + force-push.**
3. **Brama zgód dziurawa**: narzędzia MCP/pluginów/skills domyślnie → `"write"` → wykonują się bez zgody; fail-open gdy brak handlera; `autoConsent` (Boss) globalnie omija potwierdzenia.

### 🟠 Ważne
4. **3 osierocone moduły sales** (`deliverability`, `perfAudit`, `followupEngine`) — napisane + przetestowane, zero wywołań w produkcji. `followupEngine` zależy od nieistniejącego `tracking.ts`.
5. **`leads.findEmailOnSite`** pobiera HTML wprost → CORS blokuje na telefonie, choć `siteAuditClient` (BFF) istnieje dokładnie po to.
6. **BFF**: `sync`/`smtp` Bearer niewalidowane (token = klucz KV); `appTokenBad` domyślnie fail-open (decyzja właściciela — opt-in); rezydualny SSRF przez DNS-rebind; rate-limit tylko na 4 trasach proxy.
7. **White-label nie działa** (brand nie dociera do promptu); **persona rozjechana** (Onboarding 4 ids vs Settings 6).
8. **Electron**: `cmd /c start` z argumentem kontrolowanym (injection, za bramką IPC-trust).
9. **ESLint pomija** `electron/*`, `worker.js`, `scripts` — najbardziej wrażliwy kod bez lintu.

---

## 5. REDUNDANCIES (do usunięcia/scalenia)

1. **3 osierocone moduły sales** → usunąć lub podpiąć.
2. **`diagnostics.ts`** = podzbiór `healthCheck.ts` → usunąć.
3. **`dailyBriefing.ts`** = duplikat `chiefOfStaff.ts` → scalić.
4. **`proactive.ts` + `proactivity.ts`** → scalić w `predict.ts`; `predictionsSummary` to martwy kod.
5. **5 ręcznych ring-bufferów** → jeden wspólny util.
6. **4× boilerplate managera workera** + 4× szkielet workera.
7. **Tavily ×3, wysyłka e-mail ×3, EMAIL_RE ×3, normalizeUrl ×3, `scoreLead` ×2** (skale 0-10 vs 0-100).
8. **`skills.ts` ≈ `PluginRegistry.ts`**.
9. **3 orby** (LiveOverlay, HeadsetMode, VoiceCore).
10. **`NeuralInterface`** — duplikuje całe UI czatu, ciągnie Tailwind+framer+lucide dla jednego ukrytego ekranu (`#neural`).
11. **`DayPlan` ≈ `TaskHub`**.

---

## 6. SCOPE-CREEP (poza rdzeń asystenta)
- `ppg.ts` — puls z kamery (out of scope, ryzyko medyczne).
- `habit.ts` — mechanika DAU/streak (growth-hacking).
- `cards.ts`/`Cards.tsx` — klon Anki (osobny produkt).
- `Journal.tsx` — dziennik (styczne).
- `iqProbe.ts` + `league.ts` — „IQ modelu" z 6 pytań.
- `fitness.ts` + `FitnessPanel` — gamifikacja onboardingu udająca diagnostykę.

---

## 7. DESIGN CLARITY

**Lokalnie: tak** — moduły czytelne, czyste, udokumentowane.
**Globalnie: częściowo** — brak jednego źródła prawdy w wielu domenach (osobowość, klasyfikacja złożoności, scoring zdrowia, proaktywność, briefing, lista narzędzi, „język"). Nowy programista trafia na 3-5 plików robiących pozornie to samo. Rozwój bezpieczny w obrębie modułu, ryzykowny przekrojowo; god-components wymuszają edycję w wielu miejscach.

**Diagnoza jednozdaniowa**: *funkcjonalnie bogaty i runtime-stabilny system, którego największym długiem nie są bugi, lecz nadmiarowość — zbyt wiele implementacji tych samych pojęć i funkcje wykraczające poza rdzeń asystenta.*

---

## 8. PLAN NAPRAWCZY (4 fazy)

- **Faza 1 — Krytyczne dane + bezpieczeństwo**: kolizja klucza localStorage; keystore/APK; brama zgód (MCP/plugin domyślnie nie-`write`, zakres `autoConsent`); BFF fail-closed + walidacja Bearer + rate-limit search/embed; ESLint na electron/worker/scripts.
- **Faza 2 — Bezwzględne przycinanie**: usunąć osierocone moduły sales; `diagnostics.ts`; `dailyBriefing.ts`; `DayPlan`; ocenić `NeuralInterface`.
- **Faza 3 — Konsolidacja silników**: proaktywne→`predict`; detektory złożoności→1 util; ring-buffery→1 util; managery workerów→1 fabryka.
- **Faza 4 — Dekompozycja god-components + unifikacja stanu**: `App.tsx`→hooki (`useSystemLoops`/`useJarvisState`); `episodicMemory`/`usage`→`db.ts`; white-label→prompt; ujednolicić zapis ustawień (natychmiastowy).

> Uwaga inżynierska: pozycje nieodwracalne / wpływające na żywe wdrożenie (rotacja keystore Play, fail-closed domyślny BFF) były wcześniej świadomie odłożone przez właściciela (PROGRESS.md, Faza F „STOP-and-ASK") — wymagają potwierdzenia przed wdrożeniem.
