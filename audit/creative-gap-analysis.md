# JARVIS — Creative Gap Analysis (PHASE 1)

> Porównanie architektury systemu kreatywnego JARVIS-a do światowych standardów:
> Midjourney, Canva AI, Adobe Firefly, Framer AI, Durable AI, Webflow, Galileo AI.
> Oceny 0–100 ze ŚCISŁYM uzasadnieniem architektonicznym (nie marketingowym). Stan 2026-06-25.

## Tabela ocen

| Wymiar | JARVIS | Lider (≈) | Uzasadnienie architektoniczne |
|---|---:|---:|---|
| Image Quality Control | **32** | Firefly/MJ 92 | Generujemy przez modele zewn., ale ZERO oceny kompozycji/światła/czytelności, brak rankingu wyjść, brak regeneracji najsłabszego, brak upscalingu w pipeline, 1 obraz na raz. Mamy tylko: koszt, auto-fallback, asystent edycji. |
| Prompt Intelligence | **55** | MJ 88 | `refineEdit` (zasady Nano Banana, dopytanie), system-prompty ad/content — dobre. Brak: rozszerzania promptu jako tokeny (styl/kompozycja/lens), negatywnych promptów, blendowania, presetów wielokrotnych, seedów w UX. |
| Brand Consistency | **18** | Canva 92 | `brand.ts` zwraca tylko nazwę. Brak brand-kitu (logo/kolory/fonty/ton), brak pamięci estetyki per-użytkownik, brak generatora style-guide, brak wstrzykiwania marki do obrazu/strony. To największa luka. |
| Website Conversion Power | **60** | Framer/Webflow+CRO 90 | FULL_SPEC daje CTA/SEO/forms/FAQ; `auditSite` (SEO/a11y/UX 0–100); `improveSite`; `analyzeBusiness` (strategia). Brak: dedykowanego scoringu konwersji (nagłówek/oferta/psychologia ceny/social proof), funnela, A/B, śledzenia. |
| UX Generation Quality | **72** | Galileo/Framer 90 | Prompt klasy Awwwards + premium + 19 stylów + sekcje premium → realnie dobra jednoplikowa strona. Sufit: brak reużywalnych komponentów, brak zapisanych tokenów, brak testu responsywności/renderu. |
| Template Intelligence | **52** | Webflow/Framer 88 | 11 systemów projektowych + 10 sekcji + KIND_HINTS = quasi-szablony. Brak: zapisanych, parametryzowanych, remiksowalnych szablonów; brak biblioteki/marketu; brak „zastosuj ten layout do mojej treści". |
| Agent Autonomy | **45** | Galileo/Durable 85 | `improveSite` (krytyka→przebudowa), `analyzeBusiness`, asystent edycji (clarify-before-spend). Brak: wielu agentów krytykujących się wzajemnie i zbiegających do optimum, brak agenta jakości rankującego obrazy, brak pętli do progu score. |

**Średnia ważona JARVIS ≈ 48/100.** Lider rynku ≈ 89/100. Luka realna, ale skoncentrowana w kilku warstwach.

## Gdzie naprawdę przegrywamy (i dlaczego architektonicznie)

1. **Brand Consistency (18)** — brak ENCJI `BrandKit` i pamięci wizualnej. Bez tego każda generacja startuje „od zera" → niespójność. Canva/Firefly trzymają tożsamość marki i wstrzykują ją wszędzie.
2. **Image Quality Control (32)** — brak pętli „generuj N → oceń → wybierz/regeneruj". Midjourney domyślnie daje 4 warianty + upscale/vary. My: 1 strzał, brak oceny.
3. **Agent Autonomy (45)** — mamy POJEDYNCZE pętle (improveSite), nie SYSTEM agentów. Galileo/Durable konwergują projekt przez wielokrotną krytykę.

## Wymagane skoki architektoniczne (by realnie gonić liderów)

| Skok | Co wnosi | Warstwa |
|---|---|---|
| **A. Warstwa danych kreatywnych** (`Project/Asset/Variant/BrandKit` w store) | Trwała biblioteka, warianty, historia, brand memory | stan/dane |
| **B. System marki** (brand-kit: kolory/fonty/logo/ton + wstrzykiwanie do promptów) | Spójność wizualna obraz↔strona | brand |
| **C. Multi-variant + Quality Agent** (generuj N, oceń heurystyką, rankuj, regeneruj najsłabszy) | Skok jakości obrazu | obraz |
| **D. Conversion AI** (czysty scorer: nagłówek/CTA/oferta/trust/cena/social-proof + plan poprawy) | Moc konwersji stron | web |
| **E. Funnel/Business model** (z 1 pliku → magnet+sekwencja+pipeline jako artefakty) | „generuj biznes, nie stronę" | web/sales |
| **F. Orkiestracja agentów** (Prompt Eng. ↔ Brand ↔ UX ↔ Copywriter ↔ Conversion — wzajemna krytyka) | Autonomia i konwergencja | agenty |

## Wykonalność w obecnej architekturze (uczciwie)
- **Wykonalne tu i teraz (klient, bez backendu):** A (encje w store), B (brand-kit lokalny), C (multi-variant + heurystyka jakości — pollinations jest darmowy, więc N wariantów = 0 zł), D (Conversion AI jako czysta funkcja na HTML), F (orkiestracja przez sekwencje wywołań mózgu).
- **Wymaga zewnętrznych zależności / backendu:** prawdziwy upscaling premium, headless-render do oceny wizualnej obrazu, realne A/B z ruchem/analityką, deploy/publikacja, modele text→image klasy Midjourney (płatne API).

## Rekomendowana kolejność (ROI / złożoność / ryzyko)
1. **D — Conversion AI** (ROI wysoki, złożoność niska, ryzyko niskie) — rozszerza istniejący `auditSite`, czysta i testowalna.
2. **B — Brand-kit** (ROI wysoki, złożoność średnia) — odblokowuje spójność i jest wstrzykiwany wszędzie.
3. **C — Multi-variant + Quality Agent** (ROI wysoki, złożoność średnia) — darmowe warianty (pollinations) + ranking.
4. **A — Encje kreatywne** (fundament pod B/C, złożoność średnia).
5. **F — Orkiestracja agentów** (po A–D).
6. **E — Funnel** (najwięcej pracy; po fundamentach).

> Wniosek: nie potrzebujemy „przepisać wszystkiego". Potrzebujemy **warstwy danych + marki + pętli jakości + scoringu konwersji** — to przesuwa średnią z ~48 w okolice 70+, a w web-konwersji i UX realnie do poziomu liderów. Reszta (modele premium, deploy) zależy od budżetu/backendu, nie od kodu klienta.
