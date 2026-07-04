# JARVIS — Creative System Audit (PHASE 0)

> Read-only deep scan systemu kreatywnego (obraz + strony). Stan 2026-06-25. Brutalnie szczerze:
> nazywam dług techniczny i braki architektury, nie tylko funkcje. Oparte wyłącznie na kodzie repo.

## 1. Generacja obrazów — `src/lib/images.ts` (235 l.)
- Modele: `pollinations` (darmowy, bez klucza, text→image), `gemini` Nano Banana (darmowy z kluczem, edycja), `fal-flux-kontext` / `fal-nano-banana` (premium, EDYCJA tylko — wymaga zdjęcia), `local-sd` (Stable Diffusion na PC).
- `generateImage(prompt, input, model, sdOpts)` — fasada nad 4 ścieżkami. `bestImageModel(forEdit)` — auto-dobór (sd → fal-do-edycji → gemini → pollinations). `imageModelCost`, `FAL_COST`, telemetria kosztów (`recordUsage` → `usageTelemetry.ts`).
- **Dług/braki:** brak modeli text→image klasy premium (fal to tu tylko edytory); brak negatywnych promptów, seedów-jako-UI, wariantów (1 obraz na raz); brak oceny jakości/rankingu; brak upscalingu w pipeline.

## 2. Obsługa promptów — `editAssistant.ts` (58), `images.geminiEditPrompt`, `adStudio.ts`, `contentStudio.ts`
- `refineEdit(instruction, hasImage)` — DARMOWY mózg zamienia polecenie PL na precyzyjny prompt EN wg zasad Nano Banana, dopytuje przy niejasności (oszczędza płatne próby). `geminiEditPrompt` — szablon edycji.
- `adSystem/adUserPrompt` (Google/Meta), `contentSystem/contentUserPrompt` (IG/FB/TikTok/LinkedIn) — system-prompty pod treści/reklamy.
- **Dług/braki:** brak biblioteki rozszerzania promptu (styl/kompozycja/oświetlenie jako tokeny), brak blendowania wielu promptów, brak presetów promptów wielokrotnego użytku.

## 3. Generacja UI/stron — `webgen.ts` (~330 l.)
- `generateSite` → `askModel({heavy})` → JEDEN plik HTML (wbudowany CSS/JS). Warstwy promptu: BASE (Awwwards) + PREMIUM (pionierskie techniki) + FULL_SPEC (SEO/schema/OG/Twitter/FAQ/forms/RODO/WCAG) + KIND_HINTS + STYLE_HINTS (19 stylów, w tym 11 systemów projektowych) + SECTION_PRESETS (10 sekcji premium).
- `pickSiteStyle` (auto-dobór), `auditSite` (0–100 SEO/a11y/UX), `improveSite` (samodoskonalenie), `analyzeBusiness`+`buildStrategySeed` (strategia).
- **Dług/braki:** to STRONA JEDNOPLIKOWA, nie „biznes" — brak wielostron, brak współdzielonych komponentów, brak systemu tokenów zapisanego, brak realnego renderu/testu (tylko iframe-podgląd).

## 4. Pipeline buildera — `WebStudio.tsx` (415 l. po rozbudowie)
Opis/brief/strategia → `generateSite` → `setHtml` → podgląd w **sandbox iframe** → audyt → „Ulepsz"/„Dodaj sekcję" → eksport. **Dług:** komponent rośnie (god-component), logika generacji/wyceny/audytu/sekcji w jednym pliku.

## 5. System komponentów
Czyste komponenty React+Vite, własne `.chip/.btn/.journal-card/.panel`. **BRAK** biblioteki komponentów design-systemowych (shadcn-like), brak storybooka, brak reużywalnych bloków UI dla generatora — „premium" żyje w prompcie, nie w kodzie.

## 6. Stan — `store.ts` (RAM + localStorage + IndexedDB)
`settings` + `data`. **BRAK ENCJI KREATYWNYCH:** nie ma modelu `CreativeProject / Asset / Variant / BrandKit`. Obrazy żyją tylko w `history[]` stanu Studia (ulotne), strony w `html` stanu WebStudio. Zero trwałej biblioteki dzieł użytkownika.

## 7. Integracje AI — `src/lib/providers/` (anthropic/gemini/openai/registry/webllm) + `brain.ts`
Mózg (tekst) ma routing/failover/circuit-breaker. Obrazy idą BEZPOŚREDNIM fetch do pollinations/gemini/fal (poza warstwą providerów). **Dług:** dwa różne tory (tekst przez `brain`, obraz przez `images`) — brak wspólnej abstrakcji „modalność".

## 8. Rendering
- Obraz: `<img src=data/blob>` + opcjonalny efekt Web Audio (to dla głosu). 
- Strona: **sandbox iframe** (srcdoc/blob) — bezpieczny podgląd. **BRAK** realnego headless-renderu (telefon nie odpali Chromium) → brak screenshotów/testów wizualnych w aplikacji.

## 9. Eksport — `Studio.download` (PNG), `WebStudio.download` (.html)
Pojedynczy plik. **BRAK:** eksportu paczki (zip: html+assets), brak deployu/publikacji online, brak eksportu do React/Next, brak eksportu wariantów/zestawów.

## 10. Szablony i Brand — `brand.ts` (8 l.!) , STYLE_HINTS
`brand.ts` zwraca tylko NAZWĘ („JARVIS"). **BRAK SYSTEMU MARKI:** zero przechowywanego brand-kitu (logo/kolory/fonty/ton), zero uczonej estetyki per-użytkownik, zero generatora style-guide. STYLE_HINTS pełnią rolę „szablonów", ale nie są zapisane/parametryzowane/remiksowalne.

---

## Podsumowanie długu technicznego (priorytety)
1. **Brak warstwy danych kreatywnych** (Project/Asset/Variant/BrandKit) — wszystko ulotne w stanie ekranu. To blokuje bibliotekę dzieł, brand memory, warianty, historię.
2. **Brak systemu marki** — `brand.ts` to zaślepka; bez brand-kitu obraz i strona nie są spójne wizualnie między generacjami.
3. **Brak zarządzania jakością obrazu** — 1 obraz, zero rankingu/regeneracji najsłabszego/wariantów/upscalingu.
4. **Strona = 1 plik, nie biznes** — brak funnela (magnet+sekwencja+pipeline), brak wielostron, brak A/B.
5. **God-components** (Studio 415, WebStudio 415) — logika do wydzielenia (SOLID/feature-isolation).
6. **Dwa tory AI** (tekst vs obraz) bez wspólnej abstrakcji modalności.

## Mocne strony (uczciwie)
Prompt-engineering stron jest realnie wysokiej klasy (Awwwards + FULL_SPEC + 19 stylów + sekcje); Studio ma przejrzystość kosztów, auto-fallback i asystenta edycji oszczędzającego płatne próby; jest telemetria kosztów i audyt jakości stron. To solidny fundament — brakuje WARSTWY DANYCH i SYSTEMU MARKI, by stało się platformą.
