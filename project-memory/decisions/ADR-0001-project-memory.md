# ADR-0001: Jedna pamięć projektu z generowanym stanem i dziennikiem zdarzeń per plik

Status: proposed (czeka na recenzję człowieka lub innego agenta)
Data: 2026-11-24 · Autor: antigravity (Sprint 5a) · Recenzent: wymagany człowiek lub inny agent (zasada „autor ≠ jedyny recenzent”)

## Kontekst
- Projekt prowadzą na zmianę różne agenty (Antigravity, Codex, Claude) i różne modele. Wiedza była rozproszona
  w ~29 dokumentach `docs/` (DEVLOG, PROGRESS, horizon-memory, JARVIS_REPAIR_PLAN, kilka ROADMAP-ów, audyty),
  z deklaracjami typu „683 zielone” bez powiązania z commitem.
- Brak `AGENTS.md`/`CLAUDE.md` — każde narzędzie startowało bez wspólnych zasad.
- Dokumenty wskazane w zleceniu Sprintu 5a (`docs/JARVIS_CONTROL_CENTER.md`, `JARVIS_BACKLOG.md`, `JARVIS_NEXT.md`)
  **nie istnieją** w żadnej gałęzi ani historii gita (sprawdzone `git log --all`).

## Decyzja
1. `AGENTS.md` = jedyny protokół. `CLAUDE.md` tylko importuje go (`@AGENTS.md`). Brak osobnych reguł per narzędzie.
2. `project-memory/` przechowuje wyłącznie: stan generowany (`CURRENT_STATE.*`), zdarzenia (`events/`, 1 plik = 1 zdarzenie,
   tworzony wyłącznie), ADR (`decisions/`), nieudane podejścia (`journal/`), raporty uruchomień (`reports/`).
3. **Nie tworzymy drugiego backlogu ani roadmapy.** Otwarte sprawy są wyciągane przez generator z istniejących
   dokumentów wg `project-memory/sources.json` (z odniesieniem plik:linia).
4. Status testu = funkcja (raport z rzeczywistego uruchomienia, bieżący commit, odcisk drzewa, wiek). Brak danych → UNKNOWN.
5. Zero zależności i zero zapytań do LLM w tej fazie.

## Konsekwencje
- (+) Każda sesja zaczyna od `npm run memory:sync` i widzi realny stan; deklaracje bez raportu są niewidoczne jako PASS.
- (+) Zdarzenia równoległe nie kolidują (osobne pliki, `link()`→EEXIST); konflikty gita na `CURRENT_STATE.*` rozwiązuje się regeneracją.
- (−) `CURRENT_STATE.*` w commicie zawsze opisuje stan sprzed tego commita (snapshot) — czytelnik musi patrzeć na `git.commit`.
- (−) Ekstrakcja otwartych spraw zależy od formatu istniejących dokumentów; zmiana formatu = aktualizacja `sources.json`.
- (−) Pełne logi (`reports/logs/`) są lokalne (gitignored); w repo zostaje raport z ogonem 40 linii.

## Alternatywy odrzucone
- Jeden wspólny plik dziennika (append) — kolizje przy równoległych agentach.
- SQLite — binarny plik w gicie, konflikty nie do scalenia, nowa zależność.
- Nowy `JARVIS_BACKLOG.md` — dublowałby JARVIS_REPAIR_PLAN/ROADMAP/DEVLOG.
