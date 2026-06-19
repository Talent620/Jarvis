# JARVIS — Audyt premium („dlaczego wygląda amatorsko") + raport zmian

> Brutalnie szczery przegląd pod kątem konkurencji z ChatGPT/Claude/Gemini. Stan: **812 testów
> zielonych**, `tsc` czysty, web build OK. Branch `claude/functionality-modification-access-z9kod1`.

## 1. Werdykt jednym zdaniem
Rdzeń AI jest klasy enterprise (routing, failover, pamięć semantyczna, narzędzia, MCP, warstwa
on-device). **Amatorsko wygląda POWŁOKA**: nadmiar ekranów bez hierarchii, emoji zamiast ikon,
chaos komunikatów i — do tej zmiany — brak streamingu. To pierwsze, co widzi płacący użytkownik.

## 2. Top sygnały „to nie produkt za 99 €" (dowody w kodzie)

| # | Problem | Dowód | Status |
|---|---------|-------|--------|
| 1 | **Brak streamingu** — użytkownik gapił się w pusty orb, potem cała odpowiedź naraz | `App.tsx` blokujący `await askJarvis` | ✅ **NAPRAWIONE** (openai-compat); Claude/Gemini — w planie |
| 2 | **Scyzoryk: 53 komponenty, 39 pozycji w 1 menu** (latarka, kompas, QR, generator reklam, kreator stron, „autopilot dochodu") | `More.tsx:75–107` | ⏳ decyzja: „tylko ujednolicenie" — bez usuwania; scalenia w planie |
| 3 | **Emoji jako ikony**, bez etykiet i ARIA; 🧠 = i pamięć, i fiszki | topbar `App.tsx`, `More.tsx:78–89` | ⏳ plan (ujednolicenie ikon + ARIA) |
| 4 | **Chaos komunikatów** — 64 toasty, emoji raz z przodu/raz z tyłu/wcale, różna interpunkcja | `MemoryCenter/Cards/CostPanel/...` | ⏳ plan (jeden styl `toastOk/Err/Info`) |
| 5 | **Duplikaty dezorientujące** — Pamięć vs Profil; 4 „Studia"; 4 narzędzia zakupowe; zadania w 2 miejscach | `MemoryCenter`+`Profile`, `*Studio.tsx`, `Shopping*` | ⏳ zatwierdzone scalenia (4 Studia→1, Pamięć+Profil→1, Zakupy→1) |
| 6 | **Brak streaming/skeletonów** — „Tworzę…" tekstem zamiast szkieletu/animacji | `Cards/ContentStudio/Studio/Translator` | ⏳ plan (wspólny skeleton) |
| 7 | **871 inline `style={{}}`** w 44 komponentach mimo dobrych tokenów CSS | `src/components/*` | ⏳ plan (utility-klasy) |
| 8 | **Mieszanka PL/EN w nazwach** — „Ustawienia"/`Settings`, „Zadania Pro"/`TaskHub` | cały kod | ⏳ plan |
| 9 | **Brak ESLinta** w aplikacji (tylko `tsc`) | brak `.eslintrc` | ⏳ plan |

## 3. Niezawodność — zweryfikowane fałszywe alarmy (NIE „naprawiałem" działającego)
Audyt automatyczny zgłosił „leaki/race", które po weryfikacji okazały się poprawne:
- `FitnessPanel.tsx:11` — `useEffect(() => store.subscribe(...))` **zwraca** unsubscribe jako cleanup → OK.
- Pętle tła w `App.tsx` (briefing/prospect/sync) ustawiają znacznik w localStorage **przed** `await` → brak nakładania.
Dyscyplina seniora: weryfikować, zanim się „poprawi".

## 4. Co dowieziono w tej rundzie (raport zmian)

### A. Niezawodność + obserwowalność (priorytet A/E)
- `resilience.ts`: **wykładniczy backoff + jitter**, **deduplikacja żądań**, **circuit breaker** per-dostawca (half-open), **cache warstwowy** (RAM+IndexedDB, TTL).
- `errorLog.ts`: lokalny pierścień zdarzeń + **metryki** (latencja p50/p95, successRate, błędy per scope) — bez wysyłki na zewnątrz.
- `brain.ts`: retry sieci → backoff; **breaker pomija padniętego dostawcę** (nigdy nie opróżnia łańcucha); latencja/błędy do telemetrii.
- +14 testów.

### B. Streaming odpowiedzi (największy skok „premium")
- `stream.ts`: akumulator SSE (treść + `tool_calls` z fragmentów) + `drainSSE`.
- `providers/openai.ts`: ścieżka strumieniowa z **bezpiecznym fallbackiem** do pełnej odpowiedzi.
- `brain.ts`/`App.tsx`: `onToken` z akumulatorem **per próba** (czysty failover); bąbel tworzony **leniwie** przy 1. tokenie (zero regresji dla dostawców bez streamingu).
- Pokrycie: Groq, Cerebras, OpenRouter, NVIDIA, GitHub, **Ollama (on-device)** + przez proxy BFF.
- +6 testów. Łącznie **812 zielonych**.

## 5. Świadomie ODŁOŻONE (z uzasadnieniem — nie pominięcie)
- **Streaming Anthropic/Gemini** — inne formaty SSE; adapter Claude ma subtelny fallback `thinking`/400. To **domyślny** dostawca → zmiana „w ciemno" bez testu live grozi zerwaniem flagowej ścieżki. Osobny, przetestowany etap.
- **Usuwanie ekranów** — decyzja właściciela: „tylko ujednolicenie". Scalenia (4 Studia→1, Pamięć+Profil→1, Zakupy→1) zatwierdzone do osobnego, ostrożnego etapu (ryzykowny refaktor UI, brak testu wizualnego tutaj).
- **Re-weryfikacja ID modeli** wobec żywych list — wymaga kluczy (ograniczenie środowiska).
