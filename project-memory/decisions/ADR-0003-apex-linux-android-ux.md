# ADR-0003: JARVIS Apex — parytet Linux Desktop, natywny Android UX i bezpieczny Markdown

Status: proposed
Data: 2026-11-24
Autor: antigravity
Zakres: `electron/linux-system.cjs`, `electron/launch-app.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `android/.../NativeTtsPlugin.java`, `android/.../WakeWordService.java`, `src/lib/androidNative.ts`, `src/lib/markdown.ts`, `src/components/TypeText.tsx`, `src/components/Composer.tsx`, `src/components/AutoCorePanel.tsx`, `src/styles/index.css`

## Kontekst
Po wdrożeniu AUTOCORE (`ADR-0002`) trzy obszary wyraźnie odstawały od jakości produktu końcowego:
1. **Linux Desktop (Electron):** `power`, `volume` i `media` zwracały `err:unsupported` na Linuxie, brakowało wykrywania realnego GPU/VRAM, zasobnika systemowego (`Tray`), mostka pęku kluczy OS (`safeStorage`), walidacji granic okna na wielu monitorach oraz ujednoliconej diagnostyki zależności (W1).
2. **Android APK:** `NativeTtsPlugin.speak()` rozwiązywał obietnicę natychmiast po starcie mowy (ryzyko samo-nasłuchu mikrofonu w pętli głosowej), `WakeWordService` ponawiał błędy w stałej pętli 900 ms bez backoffu i bez czyszczenia handlera, a brak obsługi sprzętowego przycisku Wstecz powodował wychodzenie z aplikacji zamiast zamykania otwartego panelu.
3. **Interfejs czatu:** odpowiedzi asystenta renderowały surowy tekst z gwiazdkami i potrójnymi backtickami bez formatowania ani kopiowania bloków kodu; brakowało wklejania obrazów (`Ctrl+V` / drag-and-drop) i historii poleceń `↑/↓` w Composerze.

## Decyzja
1. **Linux Desktop:** wydzielono testowalny moduł `electron/linux-system.cjs` bez użycia powłoki (`execFile` only): łańcuchy fallback (`loginctl`/`systemctl`, `wpctl`→`pactl`→`amixer`, `playerctl`→MPRIS), realne wykrywanie GPU/VRAM (`nvidia-smi`→sysfs→`lspci`), ujednoliconą diagnostykę W1 (`available`/`missing`/`disabled`/`error`), `clampWindowBounds`, `Tray` i `safeStorage` (z bramką `isTrustedIpc`).
2. **Android Native:** `NativeTtsPlugin.java` wykorzystuje `UtteranceProgressListener` + `USAGE_ASSISTANT` + bezpieczny timeout; `WakeWordService.java` dodaje wykładniczy backoff i zatrzymanie przy braku uprawnień; `src/lib/androidNative.ts` + `App.tsx` obsługują przycisk Wstecz LIFO z podwójnym potwierdzeniem wyjścia.
3. **Markdown & UX:** zero-zależnościowy, wolny od `dangerouslySetInnerHTML`, zgodny z ES2019/Chrome 79 parser `src/lib/markdown.ts` + `TypeText.tsx` (bloki kodu z przyciskiem Kopiuj, odrzucanie linków innych niż `http/https`), `Composer.tsx` (paste/drop obrazów, historia `↑/↓`, `⌘K`/`/`), karta dowodzenia `AutoCorePanel.tsx` z miernikiem budżetu i diagnostyką W1 oraz warstwa stylów `index.css` z poszanowaniem `low-power` i `prefers-reduced-motion`.

## Konsekwencje
- Zerowa liczba nowych zależności w `package.json`.
- Zgodność ze starszym Android WebView (Samsung S9 / Chrome 79) zachowana i sprawdzana testami.
- Wymaga recenzji przez właściciela lub innego agenta przed scaleniem z `main` (`AGENTS.md`).
