# ADR-0004: JARVIS OMNI-PILOT — głosowe sterowanie pulpitem, Visual Grounding [0..1000] i bezpieczna pętla Computer Use

Status: proposed
Data: 2026-11-24
Autor: antigravity
Zakres: `electron/desktop-pilot.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `src/lib/desktop.ts`, `src/lib/omniReflex.ts`, `src/lib/omniVision.ts`, `src/lib/omniPilot.ts`, `src/components/OmniPilotHud.tsx`, `src/lib/tools.ts`, `src/lib/toolSelector.ts`, `src/lib/permissions.ts`, `src/lib/selfManifest.ts`, `src/App.tsx`, `src/styles/index.css`

## Kontekst
Użytkownik potrzebuje realnego, płynnego sterowania komputerem z poziomu naturalnej mowy po polsku („przesuń kursor w prawo”, „przesuń kursor na ikonę Firefox”, „kliknij przycisk Zapisz”, „zrób na komputerze: …”) na Linuxie i Windowsie. Istniejący moduł `electron/linux-keyboard.cjs` celowo wspiera jedynie restrykcyjny tryb X11 ASCII ze sprawdzaniem aktywnego okna i nie wolno łamać jego kontraktu ani testów regresyjnych. Jednocześnie pełna autonomia na pulpicie niesie poważne ryzyko bezpieczeństwa (hasła, 2FA, płatności, akcje nieodwracalne, niekontrolowane pętle klikania).

## Decyzja
Wdrożono 6-warstwową architekturę **JARVIS OMNI-PILOT** bez dodawania zewnętrznych zależności:
1. **Aktuator OS (`electron/desktop-pilot.cjs` + IPC w `main.cjs`/`preload.cjs`):** osobny moduł obok `linux-keyboard.cjs` (100% wstecznej kompatybilności). Zapewnia płynny, nieliniowy (cubic ease-in-out) ruch kursora, ruch względny/absolutny/nazwany (`center`, rogi, `dock`), kliknięcia (`click`/`double`/`right`/`middle`), przewijanie, drag, listowanie i przełączanie okien (`wmctrl`/PowerShell), wpisywanie pełnego polskiego UTF-8 z atomowym przywracaniem schowka użytkownika, obsługę Linux X11 (`xdotool`), fallback Wayland (`ydotool` z uczciwym `err:wayland-ydotool-missing` przy braku demona) oraz sprzętowy **Kill-Switch `Ctrl+Alt+X`** (`jarvis:omni-abort`). Wszystkie kanały IPC są chronione bramką `isTrustedIpc`.
2. **Natychmiastowy Refleks Głosowy (`src/lib/omniReflex.ts`):** deterministyczny, offline'owy parser komend po polsku (odporny na brak diakrytyków z STT, zgodny z ES2019/Chrome 79) działający w czasie <30 ms i 0 USD dla ruchu kursora, kliknięć, przewijania, okien, głośności, mediów, skrótów i dyktowania.
3. **Visual Grounding [0..1000] + Desktop RiskGuard (`src/lib/omniVision.ts`):** namierzanie dowolnych elementów UI przez AutoCore AI Gateway (`aiRequest({ task: "E_vision" })`) w znormalizowanej przestrzeni `0..1000` (niezależnej od rozdzielczości i skalowania HiDPI) oraz twardy RiskGuard: bezwzględna blokada pól haseł/2FA/kluczy prywatnych, jawne potwierdzenie przed płatnościami/akcjami nieodwracalnymi/wysyłką oraz zakaz omijania CAPTCHA.
4. **Orkiestrator i pętla autonomiczna (`src/lib/omniPilot.ts`):** pętla `Obserwuj → Zaplanuj → RiskGuard → Wykonaj → Zweryfikuj` z limitem kroków (domyślnie 6, maks. 12), detekcją stagnacji (ochrona przed zapętleniem), mostem potwierdzenia w HUD i natychmiastowym przerwaniem przez token wykonania + `abortHardware()`.
5. **Live Visual Grounding HUD (`src/components/OmniPilotHud.tsx`):** pływający panel z podglądem ekranu, animowaną retikulą celowniczą `(xNorm%, yNorm%)`, pewnością namierzenia, dziennikiem kroków, kartą zgody RiskGuard i czerwonym przyciskiem awaryjnym `⏹ STOP (Ctrl+Alt+X)`.
6. **Integracja z ekosystemem narzędzi:** 8 nowych narzędzi `desktop_*` z jawną klasyfikacją ryzyka w `src/lib/permissions.ts`, słowami kluczowymi w `src/lib/toolSelector.ts`, wpisem w `src/lib/selfManifest.ts` oraz szybkim przechwytywaniem komend w `src/App.tsx` wyłącznie na desktopie.

## Konsekwencje
- Zachowana pełna zgodność z Chrome 79 / Samsung S9 (ES2019) i istniejącymi testami `linux-keyboard.cjs`.
- Zerowy wpływ na APK Android i tryb przeglądarkowy (`executeOmniVoiceCommand` aktywne wyłącznie przy `isDesktop()`).
- Fizyczne działanie na żywym serwerze wyświetlania (X11 / Wayland `ydotoold` / Windows) pozostaje do testu na maszynie użytkownika (środowisko VM nie posiada serwera graficznego — status `UNKNOWN` w dowodach).
- Wymaga niezależnej recenzji (człowiek lub inny agent) przed scaleniem do `main` zgodnie z `AGENTS.md`.
