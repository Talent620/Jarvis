# RELEASE NOTES — JARVIS (program premium)

Branch: `claude/functionality-modification-access-z9kod1`
Status: **792 testy zielone**, `tsc` czysty, `npm run build` OK, skan sekretów czysty.
APK + EXE publikowane automatycznie pod stałym tagiem `latest` (odświeżane przy każdym pushu):
- 📱 `https://github.com/Talent620/Jarvis/releases/download/latest/jarvis.apk`
- 💻 `https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe`

---

## ▶ PROGRAM ON-DEVICE (AI lokalna, WebGPU/WASM) — fazy A–G

Pionierska warstwa **AI on-device**: mózg, pamięć i głos działające lokalnie w przeglądarce/APK,
bez serwera. Wszystko jako **opcja z capability-check + cichym fallbackiem do chmury** — istniejąca
ścieżka chmurowa pozostaje nietknięta. Ciężkie biblioteki ładowane **leniwie z CDN w Web Workerach**
(nie wchodzą do głównego bundla); wagi modeli cache'owane po pierwszym pobraniu.

| Faza | Zakres | Status |
|---|---|---|
| A | Fundament IndexedDB (Dexie) — koniec sufitu ~5 MB localStorage; migracja + hydratacja | ✅ |
| B | Pamięć on-device — embeddingi (Transformers.js, MiniLM-L12 384-wym., PL) + fallback | ✅ |
| C | Mózg on-device — provider **WebLLM** (WebGPU), tryb prywatny w PWA/APK bez serwera | ✅ |
| D | Głos on-device — STT Whisper + TTS Kokoro + naprawa echa (mute na czas TTS) | ✅ |
| E | Odświeżenie modeli + OpenRouter jako brama failover/salda | ✅ |
| F | Utwardzenie pod sprzedaż — bezpieczne wdrożone; ryzykowne odłożone decyzją właściciela | ✅ |
| G | Samokontrola + te notatki | ✅ |

### Jak włączyć (⚙ → AI)
- **🧠 Pamięć on-device (embeddingi)** — wektory pamięci liczone lokalnie. Pierwsze użycie pobiera ~45 MB.
- **🧩 Mózg on-device (WebLLM)** — model językowy w przeglądarce na WebGPU; wybór modelu + pasek pobierania.
  Działa też jako Tryb Prywatny w PWA/APK (bez Ollamy) i jako jedyny model przy „Tryb on-device".
- **🎙 Rozpoznawanie mowy on-device (Whisper)** — transkrypcja lokalnie zamiast Groq.
- **🔊 Synteza mowy on-device (Kokoro)** — głos lokalny (najlepszy dla EN; PL ograniczony → fallback).

### Wymagania i ograniczenia (uczciwie)
- **WebGPU** wymagane dla mózgu WebLLM (brak → cicho używasz chmury). Embeddingi/Whisper działają też na **WASM** (wolniej).
- Pierwsze użycie pobiera wagi modelu (jednorazowo, potem cache w przeglądarce) — wymaga sieci na start.
- Pokrycie mobilne ~70–75% (zależnie od wsparcia WebGPU w WebView/przeglądarce); **zawsze** jest fallback do chmury.
- Małe modele lokalne **nie prowadzą pętli narzędzi** — złożone akcje/narzędzia obsługują adaptery chmurowe.
- Kokoro TTS: jakość polskiego ograniczona — to opcja, nie domyślny głos.

### Edge-case'y (wszystkie z fallbackiem)
Brak WebGPU → chmura · brak sieci → łańcuch failover + czytelny błąd · przerwane pobieranie wag → timeout → chmura ·
brak kredytów → rotacja kluczy/dostawców · odmowa mic/kamery → czytelny komunikat.

---

## Cel programu (10 faz — zamknięty wcześniej)
Przekształcenie JARVIS-a w czysty, produkcyjny, sprzedawalny produkt premium — w 10 fazach,
autonomicznie, z twardą zasadą: faza nie zamyka się bez zielonych testów i buildu; STOP przy
płatnościach.

## Zakres faz

| Faza | Zakres | Status |
|---|---|---|
| 0 | Audyt + `ARCHITECTURE.md` + plan + baseline git | ✅ |
| 1 | Pamięć długoterminowa (Mem0 + Qdrant, self-hosted) | ✅ |
| 2 | Warstwa MCP (klient JSON-RPC, allowlista hostów) | ✅ |
| 3 | Głos live (Gemini Live): pamięć + narzędzia + kamera + fallback | ✅ |
| 4 | Router modeli (Groq: Llama 4 Scout vs Kimi K2) + dziennik decyzji | ✅ |
| 5 | Panel kosztów / telemetria tokenów + budżet | ✅ |
| 6 | Saldo / auto-top-up (OpenRouter) | ⤼ **pominięta — decyzja właściciela (płatności)** |
| 7 | Proaktywność + pamięć epizodyczna | ✅ |
| 8 | Tryb on-device (offline / prywatność) | ✅ |
| 9 | Produktyzacja (onboarding, white-label, docs) | ✅ |
| 10 | Samokontrola + te notatki | ✅ |

## Najważniejsze nowości

### Pamięć (Faza 1)
- `memoryService.ts` — Mem0 + Qdrant (add/search/getAll/update/delete), namespace personal/business,
  graceful degradation. Wpięte w `brain.ts` (kontekst przed modelem, zapis po odpowiedzi).
- Serwer w `server/` (docker-compose + README). Bez hosta JARVIS działa normalnie.

### MCP (Faza 2)
- `mcp.ts` `McpManager` — klient zgodny z MCP (initialize/tools/list/tools/call), **allowlista hostów**
  (anty tool-poisoning), narzędzia rejestrowane natywnie dla modelu, graceful degradation.
- Decyzja: lekki klient protokolarny zamiast node-SDK w bundlu PWA; `google.ts` zostaje fallbackiem.

### Głos live (Faza 3)
- Sesja Gemini Live z **pamięcią Mem0** i **narzędziami** (function calling). Bezpieczny podzbiór:
  read/write + MCP; `outbound` pomijane (brak bramki zgody w trybie live → anty-przypadkowe akcje).
- Opcjonalna **kamera** (1 fps JPEG → model „widzi"), fallback do trybu rozmowy/tekstu.

### Router modeli (Faza 4)
- `modelRouter.ts` — klasyfikacja zadania (simple/complex/vision), Groq **Llama 4 Scout** (szybki,
  multimodalny) vs **Kimi K2** (rozumowanie/kod), **dziennik decyzji** (zasila panel kosztów).
- Retry + fallback dostawców już w `brain.ts`. Osobowość bez zmian.

### Koszty (Faza 5)
- `usageTelemetry.ts` — realne tokeny ze wszystkich adapterów, wycena (cennik + nadpisania), agregacje
  (dziś/7/30 dni), per dostawca/model, **prognoza miesięczna** i **budżet** (⚠ ≥80%, ⛔ ≥100%).
- Ekran **💸 Koszty AI** (menu „Więcej").

### Proaktywność (Faza 7)
- `episodicMemory.ts` — dziennik zdarzeń + wykrywanie powracających, porzuconych tematów.
- `proactivity.ts` — propozycje „z inicjatywy" (najbliższe wydarzenie, poranny briefing, zaległe
  zadania, powracający temat). Sekcja **💡 Propozycje JARVIS-a** w Powiadomieniach.

### Prywatność (Faza 8)
- **Tryb on-device** — twarda blokada chmury: wyłącznie model lokalny (Ollama), web-search off,
  zero egres. Toggle w ⚙ → AI.

### Produktyzacja (Faza 9)
- **White-label** (`brandName` + `brand()`), onboarding kluczy (potwierdzony), `USER_GUIDE.md`.

## Decyzje architektoniczne (spójne)
- Nie wbijamy ciężkich frameworków/SDK do bundla PWA (node-MCP-SDK, Mastra, WASM/WebGPU) — realizujemy
  te same pojęcia lekko (klient protokolarny, router+dziennik, lokalny model przez Ollamę).
- Usługi „żywe" (Qdrant/Mem0, podpisany APK, klucze live) wymagają hosta/kluczy właściciela — kod +
  testy (mock/HTTP) + graceful degradation są gotowe; nic nie psuje się bez nich.

## Świadomie odłożone
- Faza 6 (płatności/auto-top-up) — pominięta na wyraźną decyzję właściciela (2026-06-18).
- Utwardzenie sekretów BYOK (szyfrowanie kluczy w spoczynku), pozycje z `AUDIT.md §9` / `SECURITY.md`.

## Jakość
- Vitest: **739** zielonych (programowe moduły: memoryService, mcp, liveVoice, modelRouter,
  usageTelemetry, episodicMemory, proactivity, onDevice, brand). CI buduje web/APK/EXE.
