# Nieudane podejścia — dziennik

> Każdy agent **czyta ten plik przed** podjęciem zadania w tym samym obszarze. Wpis = fakt z dowodem
> (commit, run CI, log). Hipotezy o przyczynie oznaczaj „HIPOTEZA”. Bez sekretów i treści prywatnych rozmów.
> Dopisuj nowe wpisy na końcu z kolejnym numerem `FA-NNN`; istniejących nie przepisuj (najwyżej dodaj „Aktualizacja”).

## FA-001 — PKCS12 z różnymi hasłami store/key → `apksigner` BadPaddingException
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** `.github/workflows/android-v2.yml`, podpis APK
- **Co próbowano:** keystore PKCS12 wygenerowany z innym `-storepass` i `-keypass`, podpis przez `apksigner sign`.
- **Wynik (fakt):** run CI `45396251513` — `javax.crypto.BadPaddingException` przy odczycie klucza.
- **Przyczyna (potwierdzona):** PKCS12 w praktyce wymaga identycznego hasła magazynu i klucza.
- **Co zadziałało:** nowy PKCS12 z tym samym hasłem dla obu sekretów; runy `45397052972`, `45398610490` zielone.
- **Nie powtarzać:** różnych haseł store/key przy PKCS12.

## FA-002 — `gh release upload` z maszyny VM → HTTP 401 na uploads.github.com
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** publikacja APK
- **Wynik (fakt):** upload assetu z VM kończy się 401, mimo działającego `gh` dla API.
- **HIPOTEZA:** token środowiska nie obejmuje hosta `uploads.github.com`.
- **Co zadziałało:** publikacja wyłącznie z workflow (`softprops/action-gh-release@v2`, `contents: write`).
- **Nie powtarzać:** ręcznego uploadu assetów z VM.

## FA-003 — Sideload APK z usługą Dostępności blokowany przez Google Play Protect
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** `AndroidManifest.xml`, dystrybucja APK
- **Co próbowano:** poprawny podpis V1+V2+V3, zipalign, nowy `applicationId` (`net.serwer256.jarvis.v4`, commit `d387067`).
- **Wynik (fakt):** zrzut ekranu użytkownika — „Google Play Protect: Aplikacja została zablokowana, aby chronić urządzenie”
  + „Aplikacja nie została zainstalowana”. Podpis i wyrównanie były poprawne (`apksigner verify`, `zipalign -c 4`).
- **Przyczyna (wysokie prawdopodobieństwo, nie potwierdzona przez Google):** rozszerzona ochrona przed oszustwami blokuje
  instalację z przeglądarki aplikacji deklarujących `BIND_ACCESSIBILITY_SERVICE` (oraz wrażliwe uprawnienia).
- **Co zrobiono:** wariant sideload bez `JarvisAccessibilityService` i `QUERY_ALL_PACKAGES` (commit `f5a5dc4`, release
  `v4-jarvis-apex-safe`). **Instalacja tego wariantu na telefonie użytkownika: NIEPOTWIERDZONA.**
- **Nie powtarzać:** diagnozowania „nie zainstalowano” wyłącznie po podpisie — najpierw zrzut ekranu instalatora.

## FA-004 — Nieaktualny fixture licencji po rotacji klucza ECDSA
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** `tests/license.test.ts`, `src/lib/license.ts`
- **Wynik (fakt):** 2 testy czerwone — fixture `MASTER` podpisany starym kluczem.
- **Co zadziałało:** efemeryczna para ECDSA P-256 w `beforeAll` + jawna asercja, że stary token NIE przechodzi
  z produkcyjnym kluczem (commit `ac4cbdf`). Test nie został osłabiony — sprawdza oba kierunki.
- **Nie powtarzać:** „naprawiania” testu przez usunięcie asercji lub wpisanie nowego tokenu produkcyjnego.

## FA-005 — Modal Brain: pierwsza odpowiedź po bezczynności nie mieści się w 20 s
- **Data:** 2026-11-24 · **Agent:** antigravity · **Obszar:** `deploy/modal_brain.py`
- **Wynik (fakt):** `curl --max-time 20 …/v1/models` → kod 000 (timeout), aplikacja `jarvis-brain` w stanie deployed, 0 kontenerów.
- **HIPOTEZA:** zimny start GPU + ładowanie wag (scaledown po 60 s). Nie zmierzono pełnego czasu startu.
- **Następny krok:** zmierzyć rzeczywisty cold start zanim zmieni się `scaledown_window` (koszt!).
