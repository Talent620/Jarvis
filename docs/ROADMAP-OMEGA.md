# JARVIS OMEGA — Master Roadmap (Lead Architect)

> Cel: ewolucja z „asystenta AI" w **autonomiczną osobistą platformę inteligencji**, realnie
> uruchamialną na zwykłym sprzęcie (client-first PWA + Capacitor + opcjonalny Cloudflare Worker BFF).
> Zasada nadrzędna: **zero fikcyjnej autonomii** — budujemy tylko to, co naprawdę działa w tej
> architekturze. Bez udawania Neo4j/Qdrant „w przeglądarce".

## Stan faktyczny (audyt, Faza 1)
Repo jest dojrzałe: ~1187 testów, brain z failoverem, wielodostawczy routing, pamięć (fakty +
embeddingi + Mem0 opcjonalnie), Strażnik jako system agentowy, prospekting/sprzedaż, głos,
Studio obrazów, kreator stron, lokalne AI (Ollama/WebLLM), vault AES-GCM, BFF.

### Bezpieczeństwo (AUDIT.md) — status
- ✅ Już naprawione: worker `b64` (Gmail PL), wyciek węzłów audio (`voice.ts`), walidacja
  importu kopii (`backup.ts` — whitelist endpointów + potwierdzenie).
- ⚠️ **DO DECYZJI WŁAŚCICIELA** (zmiana może zablokować działające wdrożenie / tryb hands-free):
  1. `worker.js` auth/ratelimit **fail-open** bez `APP_TOKEN` — relay kluczy bez auth.
  2. `/passthrough` = nieautoryzowany **SSRF** (brak allowlisty hostów).
  3. `permissions.ts` zgoda **fail-open** w trybie live/headset.
  4. `admin.ts` sekrety szyfrowane numerem telefonu (hash w bundlu).
  > Te cztery wymagają Twojej decyzji, bo fail-closed potrafi zepsuć obecny flow. Rekomendacja:
  > włączyć `APP_TOKEN` + allowlistę `/passthrough` (Zero-Trust BFF) — gdy potwierdzisz, wdrażam.

## Realistyczna interpretacja celów (co budujemy naprawdę)
| Wizja | Realne wdrożenie (local-first) |
|---|---|
| 7-warstwowa pamięć | Warstwy jako **role faktów + scoring/decay/reinforcement** nad istniejącym store + embeddingi; Mem0 jako opcjonalny backend. **Bez** Neo4j/Qdrant w kliencie. |
| Multi-agent | Rozbudowa istniejącego **systemu agentów Strażnika** (guardianAgents) + orkiestrator zadań. |
| World model | **Lekki graf encji** (ludzie/projekty/firmy/zadania) w store, z relacjami i pewnością. |
| Predictive | Rozbudowa `contextFusion` (Szósty Zmysł) + proaktywne rekomendacje. |
| Self-improvement | `modelRouter` adaptacyjny + log tras + ocena jakości/kosztu/latencji. |
| Security | Zero-Trust BFF (po decyzji), audit trail z redakcją. |

## Plan faz (przyrostowo, każda: testy → kod → gate → commit → raport)
- **Faza 3 (START — TA ITERACJA):** Pamięć ludzka — **scoring + decay + reinforcement** (zrobione).
- Faza 3b: role pamięci (epizodyczna/semantyczna/proceduralna/celowa) jako tagi + retrieval temporalny.
- Faza 5: World model — graf encji + ekstrakcja z rozmów (pure parser + store).
- Faza 4: Orkiestrator zadań nad agentami (dekompozycja → delegacja → scalanie), na bazie Strażnika.
- Faza 6: Predykcje (deadline'y/ryzyka/szanse) z grafu + fusion.
- Faza 7: Chief of Staff (kalendarz/cele/projekty/blokery) — spina world model + predykcje.
- Faza 2: Zero-Trust BFF (po decyzji właściciela).
- Faza 8–10: pętla samodoskonalenia, perf, hardening produkcyjny.

## Zasada wykonania
Małe, w pełni przetestowane przyrosty. Nigdy nie zostawiamy repo w stanie failing. Każdy krok
z czystymi funkcjami tam, gdzie się da (testowalność, determinizm, brak zależności sieciowych).
