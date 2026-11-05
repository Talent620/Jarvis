# Licencje APK i kontynuacja rzeczywistych testów agenta

Dodano działający przebieg **ekran aktywacji → import klucza właściciela → wydanie licencji APK → niezależna weryfikacja podpisu → aktywacja → zachowanie po ponownym załadowaniu**. Wykonano go w Chromium z sandboxem, z normalną bramką licencji. Nie jest to test fizycznego APK, pulpitu użytkownika ani autonomii modelu.

## Zabezpieczenie stanu

Baza: `b3234ca906305712ade35363cffc3524c9a1b21a`. Wcześniejsze 123 zmienione/nowe pliki zachowano w commicie `0320d50` na osobnej gałęzi `codex/apk-license-qa-20261105`. Przed commitem powstał kompletny pakiet w `/workspace/jarvis-checkpoints/2026-11-05-license-start/changes.patch`. Na odizolowanej kopii bazowego drzewa wykonano zastosowanie, porównanie hashy każdego pliku i wycofanie: [PASS](checkpoint-verification.json), [wykaz i hashe](checkpoint-manifest.json). Nie wykonywano reset/clean, nie nadpisano pracy użytkownika.

Nowe zmiany obejmują istniejący panel AdminPanel/LicenseGate, podpisywanie i weryfikację, konfigurację klucza publicznego przy budowie, CLI, lokalny instalator, ochronę aktualizacji właściciela i runnery QA. Nie utworzono nowego wykonawcy agenta. STOP i wcześniejsze testy zachowano.

## Dokładna przyczyna dwóch błędów

Na obecnym kodzie przed poprawką i na odizolowanej kopii bazowego commitu, z tym samym Node 24.22.1, Vitest i node_modules, zawodziły:

- `Licencja — weryfikacja ECDSA > akceptuje ważny klucz właściciela i czyta dane`: `expected false to be true`, asercja `r.valid`.
- `Licencja — weryfikacja ECDSA > akceptuje ważny klucz mimo brudnego wklejenia (spacje + zero-width)`: ten sam błąd na `verifyLicense(dirty).valid`.

[Baza](evidence/license-baseline-before.log), [bieżąca kopia przed](evidence/license-current-before.log), [diagnoza kryptograficzna](evidence/license-diagnosis.json).

**Przyczyna: nieaktualna podpisana próbka po rotacji klucza.** Obecny publiczny klucz jest prawidłowym punktem P-256. Podpis starej próbki weryfikuje się kluczem poprzedniego wystawcy z Workera, a nie obecnym kluczem aplikacji. To wcześniejszy defekt testu, nie nowa regresja ani niestabilność jsdom. Początkowy pomocniczy regex diagnostyczny pomylił pole `y` z końcówką `kty`; tę błędną diagnozę sprostowano i zastąpiono rzeczywistą weryfikacją WebCrypto z poprawnym odczytem pól.

Testy używają teraz tymczasowej, rzeczywistej pary testowego wystawcy, zachowując dodatnie asercje, sprawdzanie fałszerstw i zabrudzonego wklejenia. **Nie przywrócono zaufania do starego klucza i nie zmieniono domyślnego publicznego klucza autora.** Dla nowych własnych buildów użytkownik wybrał generowanie osobnej pary na swoim komputerze podczas instalacji. Test wydania/aktywacji z normalną bramką dowodzi działania konfiguracji nowej pary, a nie akceptacji starej próbki.

## Co działa w nowej funkcji

- `license:init` tworzy lokalną parę P-256, chroni prywatny plik uprawnieniami 0600, nie wypisuje sekretu i nie nadpisuje innej pary. Publiczny plik może być użyty do desktopu i APK; prywatny pozostaje poza repozytorium.
- Panel właściciela dostępny także przed aktywacją. Import klucza odblokowuje generator dopiero po rzeczywistym podpisie i weryfikacji wyzwania. Samo skopiowanie publicznych współrzędnych nie wystarcza. W tym trybie klucz nie jest zapisywany w localStorage ani wysyłany.
- Licencja ma właściciela i poprawny całkowity okres (0 = bezterminowo). Po podpisie przechodzi weryfikację aplikacji, ma widoczny pełny token do skopiowania i wpis w lokalnym rejestrze. Błędy są obsługiwane; obcy wystawca jest blokowany.
- Instalator lokalny buduje z tą samą publiczną parą i **włączoną** licencją. Sprawdza Node, JDK, SDK, sesję i opcjonalne adb. Nie instaluje pakietów systemowych, modeli ani usług; pobiera zależności projektu przez npm.
- Build z własną parą nie nadpisze jej oficjalnym OTA lub instalatorem innego wystawcy. Aktualizacje wykonuje się lokalnym instalatorem, zachowując parę. Natywnego mechanizmu instalacji APK/OTA nie testowano na telefonie.

## Wyniki i dowody

| Zakres | Wynik | Dowód |
|---|---|---|
| Pełne testy kodu | **2908 PASS, 0 FAIL**, 356 plików | [all-tests.log](evidence/all-tests.log) |
| Testy licencji, CLI, aktualizacji i regresji | 46 PASS | [regression.log](evidence/regression.log) |
| Końcowe testy CLI/instalatora i ochrony aktualizacji | 3 PASS | [final-targeted.log](evidence/final-targeted.log) |
| Lint | PASS | [lint.log](evidence/lint.log) |
| Zwykły build i build instalatora z publicznym wystawcą | PASS | [build](evidence/build.log), [owner build](evidence/owner-build.log) |
| Prywatny skalar w 71 zasobach JS buildu | nieobecny | [bundle-secrecy.json](evidence/bundle-secrecy.json) |
| Skan sekretów z rzeczywistym odczytem Git | PASS | [secret-scan.log](evidence/secret-scan.log) |
| Normalne wydanie i aktywacja licencji, poziom B | PASS, także odrzucenie obcego wystawcy | [verification.json](evidence/license-ui/verification.json), [UI](evidence/license-ui/issued-license.png) |
| Natywny APK | BLOCKED: brak Android SDK | [apk-check.log](evidence/apk-check.log) |

Pierwszy skan sekretów w ograniczonym sandboxie nie odczytał Git i zwrócił 0 bez sprawdzenia. Nie uznano go za PASS; powtórzono z rzeczywistym odczytem i zachowano prawdziwy wynik. Podobnie testy procesów CLI wykonano poza ograniczeniem blokującym spawn; nie osłabiono asercji.

## Rzeczywiste scenariusze A–D

Dodano `npm run qa:agent:real`, korzystający z istniejących helperów QA i wykonawców JARVIS-a. Profil, workspace, bundle, licencja i logi są oddzielne; każdy request modelu jest przypisany do fazy w chwili rozpoczęcia. Nie używa gotowych odpowiedzi ani wyłączenia licencji.

| Scenariusz | Stan w tej chmurze | Dalsza ścieżka |
|---|---|---|
| A — prawdziwy model, zapis i odczyt pliku | BLOCKED | Runner zleca zwykłe polecenie przez Electron; sprawdza realne API, świeżą zgodę, plik na dysku i audyt odczytu. |
| B — STOP rzeczywistej generacji | BLOCKED | Runner mierzy potwierdzenie UI, anulowanie transportu i obserwowane wyciszenie wykonawcy; poprzedni skutek A pozostaje rozliczony osobno. Nie utożsamia anulowania klienta z pomiarem pracy kernela modelu. |
| C — nowe zadanie po STOP | BLOCKED | Runner wymaga nowego requestu, świeżej zgody na konkretny nowy zapis, odczytu i braku późnego starego pliku. |
| D — zaznaczenie, schowek, fokus i edytor | NOT_RUN | Pełny wykonawca/orakl nadal nie jest zaimplementowany. Bezpośredni zapis pliku nie zastępuje tego scenariusza. |

[Maszynowy przebieg](evidence/real-agent/report.json), [Ollama](evidence/real-agent/ollama.json), [środowisko](evidence/real-agent/environment.json). Wywołano oba znane adresy: 11435 i 11434, limit 3000 ms, oba ECONNREFUSED. Adres nie został odczytany z prywatnego komputera użytkownika; bez dostępnej konfiguracji zastosowano jawne ograniczone odkrywanie. Nie uruchomiono drugiej Ollamy, nie pobrano modelu i nie użyto chmury. Trasy A–C po odblokowaniu modelu/sesji są zaimplementowane, lecz nie zostały tutaj wykonane — nie są dowodem PASS. Poprzedni brak DISPLAY/Wayland i decyzja użytkownika „bez instalacji Xvfb” nadal obowiązują.

Istniejący rejestr `../results60.json` uzupełniono o odnośniki do tej iteracji. Nie utworzono konkurencyjnej macierzy 60 i nie dodano zaliczeń autonomii na podstawie testu licencji.

## Instalacja, uruchomienie i wycofanie

Pełna instrukcja, w tym wymagania SDK/JDK, lokalizacja klucza i komendy: [LICENCJE-APK.md](../../../docs/LICENCJE-APK.md). Po pobraniu tej gałęzi:

```bash
npm run install:local -- --desktop
# lub APK z tą samą parą:
npm run install:local -- --apk --install
```

Prawdziwe testy lokalne po wydaniu licencji dla QA:

```bash
npm run license -- sign "QA lokalne" 1 --output qa-license.local
npm run qa:agent:real -- --ollama-url http://127.0.0.1:11435 --model NAZWA_ZAINSTALOWANEGO_MODELU --license-file qa-license.local
```

Stan zdalnej gałęzi i identyfikator końcowego commitu należy sprawdzić w Git; push następuje dopiero po testach. Nie przewidziano merge do main ani publikacji binarnego wydania. Twoja instalacja i produkcyjny klucz prywatny nie powstają w tej chmurze.

Wycofanie na współdzielonej gałęzi: po zachowaniu danych użyj `git revert` commitu funkcji, zachowując wcześniejszy commit STOP/QA. Do odtwarzania z bazowego drzewa można zastosować osobny pakiet zmian; kierunki sprawdzono na odizolowanej kopii. Nie cofać ani nie kasować prywatnej pary przy wycofaniu kodu — pozostaje potrzebna do własnych wydanych APK. Nie wykonywać reset/clean.
