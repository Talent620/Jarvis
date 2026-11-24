# ADR-0006: JARVIS UX/UI „Obsidian Precision” — Spójny System Wizualny, Ergonomia, Prawdziwy Motyw Jasny i Inspekcja Live

Status: proposed
Data: 2026-11-24
Autor: antigravity
Zakres: `index.html`, `src/styles/index.css`, `src/App.tsx`, `src/components/Composer.tsx`, `src/components/Settings.tsx`, `src/components/FitnessPanel.tsx`, `src/components/AutoCorePanel.tsx`, `src/components/Guardian.tsx`, `src/components/More.tsx`, `src/components/ChatHistory.tsx`, `src/components/Onboarding.tsx`, `src/lib/fitness.ts`

## Kontekst
Pełny audyt wizualny i ergonomiczny aplikacji JARVIS w żywej przeglądarce Google Chrome + Playwright (15 ekranów, 4 szerokości ekranu: 1440×900, 1280×800, 768×1024, 360×740) wykrył 12 powtarzalnych defektów klasy P0/P1 obniżających odbiór produktu:
1. **Kolizja fizyczna `BossFab` (P0):** pływający przycisk Trybu Szefa zasłaniał mikrofon (desktop 1440 px) i przycisk Wyślij (mobile 360 px).
2. **18 oślepiających białych pól formularza `#FFFFFF` w trybie ciemnym (P0):** brak globalnej bazy stylów formularzy dla `<input>`, `<select>`, `<textarea>` poza `.field`.
3. **Ucinanie Composera na mobile 360 px (P0):** 3-wierszowy nagłówek + zawijający się 3-wierszowy pasek 8 trybów (`.soul-bar`) + zduplikowany baner gotowości zgniatały pole tekstowe.
4. **Ściana `FitnessPanel` (P0):** zawsze rozwinięty panel zajmował ~85% okna na każdej zakładce Ustawień (nawet w *Głosie* i *Interfejsie*) i odsyłał do nieaktualnych nazw zakładek (`⚙ → AI`, `⚙ → Integracje`).
5. **Sprzeczne wskaźniki gotowości i fałszywy status nagłówka (P0):** `56%` w topbarze vs `8%` w Ustawieniach vs `75 (ocena B)` w Strażniku przy braku klucza AI; nagłówek pokazywał `GEMINI-2.5-FLASH · ONLINE` przy zerowej liczbie kluczy.
6. **Brak realnego motywu jasnego (P0):** `theme: "light"` nie miał reguł `body.theme-light` ani opcji wyboru w Ustawieniach.
7. **Szum wizualny i ergonomia (P1):** przeładowany 11-elementowy nagłówek z 4 zdublowanymi wyzwalaczami głosu, mieszanka ikon (emoji + Unicode + SVG), podwójne emoji w Command Palette, zduplikowany przycisk `Napraw wszystko` w Strażniku, nieczytelny znak wodny `⬢ JARVIS` zamiast przycisku `×` w modalach, toast zasłaniający dół modali oraz nieczytelny kontrast zablokowanych przycisków głównych na ekranach startowych.

## Decyzja
1. **System wizualny „Obsidian Precision” (`src/styles/index.css`):**
   - Spójna paleta powierzchni ciemnych (`#070b14` / `#0d1322` / `#131c30`), neutralne krawędzie (`rgba(148,178,214,0.14)`), pojedynczy wyrafinowany akcent `#38bdf8`, wysoki kontrast tekstu (`#edf2f7` / `#8fa3bd`).
   - Jednolita typografia UI oparta o `Inter` (z zachowaniem `Orbitron` wyłącznie jako znaku marki `JARVIS` oraz monospace dla danych/kodu), bez świecących obwódek i tekstowych cieni w nagłówkach paneli.
   - Pełny, wysokokontrastowy **motyw jasny (`body.theme-light`, porcelana/grafit `#f4f7fb` / `#ffffff` / `#0f172a` / `#0284c7`)** dostępny w *Ustawienia → Interfejs* i zarejestrowany w `App.tsx`.
   - Globalna baza ciemnych formularzy o najniższej specyficzności `(0,0,1)` (w pełni zgodna z Chrome 79 / Samsung S9 — bez `:where()` / `:has()`), natychmiast eliminująca białe pola bez nadpisywania klas specjalnych (`.composer textarea`, `.cmdk-input`).
   - Czytelny kontrast zablokowanych przycisków głównych (`.btn.primary:disabled`), przeniesienie `.toast` na górny środek ekranu oraz bezkolizyjne pozycjonowanie `.boss-fab` (poza kolumną 880 px na szerokim desktopie, bezpiecznie pod topbarem na tablet/mobile).
2. **Uproszczenie architektury i ergonomii ekranów:**
   - **Nagłówek (`.topbar`):** jeden spokojny wiersz nawet na 360 px; uczciwy status z kropką koloru (`Brak klucza AI · kliknij Ustawienia` zamiast fałszywego `ONLINE`); 5 spójnych ikon SVG z `lucide-react` (`Diagnoza`, `Rozmowa na żywo`, `Powiadomienia`, `Centrum`, `Ustawienia` + kontekstowe `Nowa rozmowa` i `Czat prywatny`). `InterfaceSwitch` pozostał w *Ustawienia → Interfejs* oraz komendach głosowych (bez zajmowania 170 px w nagłówku).
   - **Composer i `.soul-bar`:** jednolite ikony Lucide w `Composer.tsx`; jednowierszowe przewijanie poziome pasków pomocniczych chroniące wysokość pola wpisywania na mobile 360 px; usunięcie dublowania banera konfiguracji, gdy ekran powitalny już wyświetla CTA.
   - **Ustawienia i modale:** usunięcie wymuszonego auto-otwierania Ustawień przy starcie; zwinięty domyślnie, 1-wierszowy `FitnessPanel` umieszczony wyłącznie na zakładce *Mózg* poniżej `AutoCorePanel` (ze zaktualizowanymi ścieżkami w `src/lib/fitness.ts`); dodany wyraźny przycisk zamykania `×` (`.panel-close`) w nagłówkach `Settings`, `Guardian`, `More` i `ChatHistory`; usunięcie zdublowanego głównego przycisku `Napraw wszystko` w `Guardian.tsx` i uczciwy komunikat przy braku mózgu AI; usunięcie podwójnych emoji w Command Palette.

## Konsekwencje
- Zero nowych zależności npm (`lucide-react` był już zainstalowany); pełna zgodność z ES2019 / Chrome 79 (Samsung S9).
- Wszystkie 366+ plików testów (w tym strażniki `lowPowerCss`, `interactiveSemantics`, `touchTargets`, `modalMigrationGuard`, `settingsModel`, `interfaceMode`, `guardian`, `fitness`) przechodzą bez osłabiania asercji.
- Wszystkie zmiany zostały zweryfikowane wizualnie w żywym Google Chrome + Playwright na zrzutach ekranu „przed” i „po” na 4 rozdzielczościach.
- Wymaga recenzji właściciela lub innego agenta przed scaleniem z `main`.
