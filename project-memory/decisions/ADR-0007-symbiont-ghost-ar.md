# ADR-0007: JARVIS SYMBIONT Faza 1 — Ghost AR Overlay + Percepcja Deiktyczna („Pod Kursorem”)

Status: proposed
Data: 2026-11-24
Autor: antigravity
Zakres: `electron/ghost-overlay.cjs`, `electron/ghost-preload.cjs`, `electron/ghost-overlay.html`, `electron/foveated-crop.cjs`, `electron/ui-tree.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `src/lib/foveatedPerception.ts`, `src/lib/desktop.ts`, `src/lib/omniPilot.ts`, `src/components/Settings.tsx`, `src/types.ts`, `src/lib/store.ts`, `src/lib/tools.ts`, `src/lib/permissions.ts`, `src/lib/toolSelector.ts`, `src/lib/selfManifest.ts`

## Kontekst
W dotychczasowej architekturze (`ADR-0004`, `ADR-0005`) cały podgląd celowania (`OmniPilotHud`) był zamknięty wewnątrz głównego okna `mainWindow`. Gdy użytkownik pracował w innej aplikacji, nie widział na prawdziwym pulpicie na co wskazuje JARVIS ani co zamierza kliknąć. Ponadto brakowało rozumienia odniesień deiktycznych („co to jest?”, „wyjaśnij to”, „napraw to”, „kliknij tutaj”, „odpisz na to”) opartych na aktualnym położeniu kursora i lokalnym wycinku ekranu bez wysyłania pełnych zrzutów monitora.

## Decyzja
1. **Dedykowana warstwa `GhostOverlay` (`electron/ghost-overlay.cjs` + `ghost-overlay.html` + `ghost-preload.cjs`):**
   - Lekkie (<12 KB), odizolowane okno `BrowserWindow` (`sandbox: true`, `contextIsolation: true`, CSP `default-src 'none'`, brak dostępu do `jarvisDesktop`), ukryte w spoczynku (`0%` narzutu CPU/GPU gdy nieaktywne).
   - **X11 i Windows (`native-overlay`):** bezramkowe, przezroczyste, niekradnące fokusu (`focusable: false`, `showInactive()`), w 100% przepuszczające kliknięcia (`setIgnoreMouseEvents(true, { forward: true })`), z poziomem `alwaysOnTop(..., "floating")` (celowo poniżej okien bezpieczeństwa systemu takich jak Polkit / Pinentry / UAC).
   - **Wayland (`wayland-fallback`):** ponieważ protokół Wayland nie obsługuje globalnego `setAlwaysOnTop()` w Electronie, system jawnie i uczciwie przełącza prezentację do `OmniPilotHud` bez tworzenia pozornego okna, zachowując zgodność z portalem XDG ScreenCast.
   - **Wielomonitorowość i HiDPI:** `computeOverlayGeometry` wyznacza właściwy monitor (`bounds` także dla ujemnych offsetów) i przelicza fizyczne piksele (`xdotool` / `AT-SPI2` / `Win32`) na współrzędne DIP z uwzględnieniem `scaleFactor`.
   - **Uczciwa reprezentacja dokładności:** dla `AT-SPI2` / `Windows UIA` rysowana jest ramka rzeczywistych granic elementu (`width × height`); dla `Vision` rysowany jest pierścień obszaru niepewności skalowany odwrotnie do `confidence` (bez nieuprawnionej obietnicy stałych ±2 px).
2. **Tarcza Poufnych Powierzchni (`isConfidentialSurface`):**
   - Okna i węzły uwierzytelniania (`isPassword`, `polkit`, `pinentry`, `1password`, `bitwarden`, `keepass`, `gnome-keyring`, `kwallet`, `uac`, `sudo`, `hasło`, `2fa`, `otp`, `cvv`, `seed phrase`) natychmiast ukrywają `GhostOverlay` i twardo blokują wycinek obrazu przed jakimkolwiek zapisem pikseli.
3. **Foveated Perception — rozumienie „TO / TUTAJ” (`electron/ui-tree.cjs`, `electron/foveated-crop.cjs`, `src/lib/foveatedPerception.ts`):**
   - Dodano geometryczne wyszukiwanie najmniejszego elementu pod kursorem `findNodeAtPoint(nodes, x, y)` w drzewie OS.
   - Dodano lokalny wycinek `384×384 px` wokół kursora (`nativeImage.crop`) zamiast wysyłania pełnego ekranu; domyślnie analizowany lokalnie (drzewo OS + lokalna Ollama), z chmurowym Vision wyłącznie za zgodą ustawień prywatności (`onDeviceOnly`) i `budgetGate` AutoCore.
   - Przy niskiej pewności (`< 0.65`) lub ryzykownym celu JARVIS pyta o zgodę zamiast zgadywać; dla „odpisz na to” generuje wyłącznie bezpieczny szkic `DRAFT`; po kliknięciu weryfikuje rzeczywisty skutek (`verifyResult`).
4. **Bezpieczeństwo i kontrola użytkownika:**
   - Fizyczny Kill-Switch `Ctrl+Alt+X` oraz komendy głosowe `stop`/`stój`/`przerwij` synchronicznie ukrywają `GhostOverlay` i przerywają operację; przełącznik `ghostArEnabled` w Ustawieniach pozwala całkowicie wyłączyć warstwę AR.

## Konsekwencje
- Zero nowych zależności w `package.json`; pełna zgodność kodu `src/` z ES2019 / Chrome 79.
- Nowe narzędzie `desktop_foveated_inspect` jawnie sklasyfikowane w `permissions.ts` (`read`).
- Weryfikacja natywnego binarium Electron na X11/Wayland/Windows wymaga testu na fizycznym sprzęcie użytkownika (w VM binarium Electrona jest niedostępne sieciowo — potwierdzone na `Xvfb :99` przez testy jednostkowe, integracyjne i żywy render `ghost-overlay.html` w Chrome CDP).
