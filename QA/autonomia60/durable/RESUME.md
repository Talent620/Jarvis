# CI alpha.6 — kontynuacja

Commit 3ab210b147f97dbd7053653f39e0bf4da577dee9: lokalnie pełna regresja 3114/3114 PASS, 18 testów przeglądarki PASS, lint i build PASS, lokalny .deb/AppImage i sumy PASS, helper sandbox zgodny z sumą. W GitHub Tests 42143315125 i Ubuntu 42143315098 wystąpił 15-sekundowy timeout uruchomienia sandboxowanego Chrome; przyczyna nieustalona. Ograniczyć do 2 workerów Vitest, zachowując sandbox i asercje; test tej hipotezy wymaga ponownego CI i pełnej regresji. Nie tagować czerwonego commitu. qa:desktop alpha.6: lokalny przepływ i licencja PASS, model i pulpit BLOCKED. MCP i watch pozostają częściowe.

# Przygotowanie alpha.6

Tag alpha.5 eca51fe29c062456fc8712d81be47e1c6636d490 wskazuje 3a2b19da4ebb89f3c5d3ba448ba8990c4a359e8f, ale jego Ubuntu CI 42142451700 FAIL na wyścigu raportowania żądania SPA; nie opublikowano release. Zachować tag bez przepisywania. Test z wstrzymanym żądaniem reprodukuje FAIL przed poprawką; po poprawce 18/18 testów przeglądarki PASS w sandboxowanym Chromium. Oczekiwanie na uspokojenie ruchu jest ograniczone i nie dowodzi wykrycia arbitralnie opóźnionych działań. Ponowić pełną regresję, lint, build, commit i CI; kolejny tag to alpha.6. Testy alpha.5: 3113/3113 PASS lokalnie, niezależne zadanie/licencja PASS, realna Ollama/pulpit BLOCKED. MCP i watch częściowe jak poniżej. Potwierdzić opublikowane artefakty i sumy przed wskazaniem wydania.

# Przygotowanie alpha.5 — częściowy zakres

Baza a8ff49deb37347242210977dcbd3b557bc16e25e; kontynuacja na codex/skills-integration-20261105. Wyszukiwanie MCP wymaga natywnej zgody i traktuje metadane jako niezaufane; dostęp do prawdziwego rejestru w chmurze blokuje polityka sieci. Tworzenie watcha changedetection działa na kontrolowanym HTTP z trwałym zapisem zamiaru, niezależnym GET i ochroną przed ponowieniem po niepewnym skutku. Watch jest w pauzie i wyciszony: aktywacja, powiadomienia i powiązanie STOP/wznowienia z zewnętrznym watch wymagają dalszej implementacji. Brak rzeczywistej usługi, Ollamy i pulpitu. Pełna regresja 3113/3113 w 374 plikach, 87 testów integracji PASS, osobny test STOP/odczytu po ostatniej zmianie PASS, lint/build PASS. Kontrolowany composer PASS z syntetycznym modelem, qa:agent:smoke exit 2 z REAL-MODEL BLOCKED. Zachować ograniczenia opisane w CHANGELOG-ALPHA5.md. Przed podaniem instalacji alpha.5 sprawdzić commit, CI, tag, faktyczne opublikowanie i pobranie wszystkich artefaktów z sumami oraz zawartością .deb. Nie używać Xvfb, nie wyłączać sandboxa i nie publikować kluczy.

# Checkpoint alpha.4

Publiczny prerelease https://github.com/Talent620/Jarvis/releases/tag/v2.1.0-alpha.4 wskazuje `d2bc13b0a63d52e22be7307ecb39809fedf8b258`. Tag object eff3e7b0e3447fff807589fd3ff86ca762959e1c. Pobrano 9 zasobów, sumy i porównanie 17 modułów / 5 dokumentów PASS; rzeczywisty .deb ma weryfikowany helper i postinst. Bez instalacji systemowej, start obu paczek BLOCKED brak X/DISPLAY. CI tag 42138624278, branch Tests 42137864435 i Ubuntu 42137864308 PASS. Lokalne 3101/3101 PASS, lint/build PASS. Szczegóły delivery-alpha4.json.

Odczyt katalogów Skills chroni przed wykazaną podmianą, utrzymując deskryptory i porównując tożsamość. 67 testów focused PASS po ostatniej zmianie. Kontrolowany provider i prescan nie dowodzą prawdziwego rozpoznania brakującej zdolności. qa:desktop d2 exit2: niezależna komenda/settings/restart/licencja PASS, A/B/C BLOCKED. Przekazano wyłącznie selektywne dane QA bez kluczy.

MCP discovery, tworzenie watcha changedetection, ogólne trwałe wykonanie i pozostałe funkcje dokumentów/pulpitu nadal wymagają implementacji; nie nazywać ich tylko brakiem środowiska. Realny model, sesja użytkownika i skonfigurowane usługi są osobnymi przeszkodami. Android release wymaga podpisu; debug workflow nie przeszedł konfiguracji SDK. Pełny audit ma 32 zgłoszenia. Nie instalować Xvfb, nie wyłączać sandboxa i nie deklarować pracy po zakończeniu sesji. Późniejszy commit zawiera wyłącznie dowody; nie zmieniać tagu.

# Wznowienie alpha.4

Baza 8675cd6, alpha.3 pozostaje publiczna i niezmieniona. Poprawiono wyścig podmiany katalogów, nowa wersja 2.1.0-alpha.4; 67 focused PASS po ostatniej zmianie oraz kontrolowany composer PASS bez prawdziwego modelu. Pełna regresja po ostatniej zmianie: 3101/3101 PASS, 373 pliki, lint i build PASS. Przed publikacją: commit i CI, nowy tag alpha.4, potwierdzenie faktycznego Release, pobranie i weryfikacja sum, metadanych, źródeł oraz chrome-sandbox w rzeczywistej paczce. Bez Xvfb i bez wyłączenia izolacji. Brak wyszukiwania serwerów MCP oraz tworzenia nowego watcha changedetection z polecenia; nie oznaczać ich jako ukończone. Ollama, pulpit i rzeczywiste usługi są BLOCKED. Nie deklarować pracy po sesji.

# Końcowy checkpoint — alpha.3 dostarczona

Publiczny release: https://github.com/Talent620/Jarvis/releases/tag/v2.1.0-alpha.3 . Niezmienny kod, tag i paczki: `9b21a9d274fbedf30a3ce66ebd85c6415c7b64b9`; obiekt tagu `607952531aef05442e0f9e3eb4658d0602780407`. GitHub Ubuntu dla taga 42135348137 SUCCESS, Tests 42135299865 SUCCESS, lokalnie 3099 PASS. Pobrano i sprawdzono wszystkie 9 zasobów; oba ASAR są identyczne, 17 modułów i 5 dokumentów odpowiadają świeżemu tagowi. HANDOFF-ALPHA3.json: 1613 plików, 215 zmian względem fb17, pełny fsck i ancestry. Kontrola eksportu 256/256, publicznych plików 103/103. Źródła dowodów: delivery-alpha3.json i evidence/published-alpha3/EXPORTS.json. Bieżący commit dodaje wyłącznie końcową dokumentację; nie retagować wydania.

Nie wykonano instalacji ani testu na komputerze użytkownika, migracji lub rollbacku. Obie natywne próby pobranych paczek z izolowanymi profilami i sandboxem: BLOCKED — brak X/DISPLAY. Ostatni qa:desktop na3ee: niezależny interfejs, ustawienia, restart i licencja PASS; A/B/C BLOCKED — brak Ollamy na 11435/11434 i grafiki; exit2. Kod aplikacji od3ee do taga jest identyczny. Nie instalowano Xvfb, usług ani modeli, nie kontaktowano prawdziwych odbiorców i nie wyłączono licencji. Przyczyna błędów Chrome CI na3ee/6f pozostaje nieustalona; późniejszego PASS nie nazywać naprawą.

Dalszy odbiór wymaga sesji użytkownika: aktualizacja z tą samą lokalną parą właściciela według docs/WYDANIE-ALPHA.md, sprawdzenie SHA9b21a9d w Ustawienia → Dane i qa:desktop z istniejącym modelem oraz portem. Braki implementacji (dowolne plany bez renderera, źródła ofert, dokumenty/Wayland i UX), konfiguracja kanałów, siedem pól podpisu Android oraz pełny audit32 pozostają w requirements.json. G1–G10 nadal niezaliczone. Ponowny odczyt API GitHub po publikacji zwrócił Forbidden; PR nie powstał. Nie obchodzić polityki. Main, latest i poprzednie tagi pozostają bez zmian. Nie deklarować pracy po zakończeniu sesji.

# Aktualne wznowienie — kandydat wydaniaalpha.3

Kod/testy/budowanie44eeb3d5082dba934e94027abb2748d7a52c7538: local3099PASS/373pliki/0skip, GitHubTests42134605052 iUbuntu42134604873 SUCCESS wraz z pakowaniem. Bieżący commit dodaje wyłącznie dokumenty/dowody, bez zmiany tego kodu. Wcześniejsza przyczyna Chrome launch FAIL3ee/6f pozostaje nieustalona; nie ogłaszać naprawy przez diagnostykę. Sandbox, timeout15s, READY i pierwotne asercje zachowane.

Następne: zatwierdzić/wysłać doc-only kandydata, sprawdzić brak różnic runtime/test/build względem44eeb3d i zdalnySHA. Autoryzowany anotowanytagv2.1.0-alpha.3 ma wskazać tego kandydata (nie przepisywać tagówalpha1/2). Istniejącyworkflowtagu musi sam zaliczyćpełnebramki przedRelease. Potem świeżykloń taga, pobranie9artefaktów, checksumy/PROVENANCE/publicznyissuer/17modułów/5dokumentów i natywna próba z izolowanymprofilem bezsandbox-disable. Potwierdzić prawdziwyURL. Zapisfinaldelivery/HANDOFF i wyniki tylko jako dalszy doc-only commitgałęzi; tag pozostaje niezmienny.

A–C nadalBLOCKED (Ollama11435/11434 connectionrefused, brakDISPLAY); ostatniqa:desktop3ee maPASS niezależnekomendy/settings/restart/licencja, exit2. Nie instalowaćXvfb/usług/modeli, nie kontaktować realnych odbiorców, nie publikować kluczy. Androidrelease wymaga7konfiguracji podpisu. API403 blokujePR; nie obchodzićpolityki. G1–G10 pełnyodbiór nadalniezaliczony; brakówimplementacji nie nazywać brakiempulpitu. Nie deklarować pracy po końcu sesji.

# Najnowszy checkpoint — główny wyjątek Chrome

Commit6f719e1 ma lokalne3098PASS, zdalneTests42133889562PASS iUbuntu42133889657FAIL przylaunch. Ujawnione D-Bus/fonty NIE są ustaloną przyczyną. Limit sześciu linii ukrywał główny wyjątek; kolejny patch tylkohelper+unit zachowuje exception/name, processexit i fatal przed powtarzalnymstderr. Reprodukcja raportowania1FAIL/10PASS →28focusedPASS/lintPASS. Wszystkie runtimebytes, sandbox, timeouty, asercjaREADY i regułabrakufallbacku pozostają bez zmian. Dalej commit/push i rzeczywistyCI: odczytać pierwotny błąd, naprawić dopiero z dowodem. Nie tagować czerwonego Ubuntu, nie przedstawiać ostrzeżeń fontów jako przyczyny.

# Bieżące wznowienie — diagnostyka CI po3ee898c (2026-11-06)

Runtime3ee898c: lokalne3094PASS/lint/build i niezależne paczki PASS; świeżyGitHubclone zgodny. Ponowny qa:desktop3ee: komenda/settings/restart/licencjaPASS, A/B/C BLOCKED, exit2; selektywne dowody `evidence/desktop-3ee898`. Oba zdalneCI3ee (Tests42133074964, Ubuntu42133074898) FAIL przy starcie sandboxowanegoChrome: UNEXPECTED_PROBE_FAILURE. Pełnej przyczyny brak w publicznych adnotacjach, logi403/404 lubsign-in; nie zgadywać.

Nowy patch TYLKO diagnostyczny wtests/helpers/browserPrerequisite.ts, tests/browserPrerequisite.test.ts i tests/browserSession.test.ts ujawnia ograniczony/redagowany błąd i fazę. BramkaREADY, timeouty, sandbox i wszystkie pierwotne asercje bez osłabienia. Ubuntu workflow paths dodaje tests/**, by takie zmiany również uruchamiały istniejącą bramkę. Dalej zweryfikowaćfocused/lint, commit/push, odczytać rzeczywistą przyczynę następnegoCI; nie ślepo ponawiać ani tagować czerwonej wersji. Tagaalpha3 nadal nie ma. Poprzedni domyślnyJWK JEST poprawny i niezmieniony; nie wymieniać klucza. Prywatneklucze pozostają u właściciela, poprzednie podejrzenie było błędem regexu diagnostycznego.

# Bieżące wznowienie — finalna kontrola alpha.3

Przedcommitem08e02d5: Tests42131810647 iUbuntu42131810693 PASS. Nowe finalne zmiany (tylko kontrola pakowania/publiczny eksport metadanych) przeszły3094/3094 testów,373pliki,0skip orazlint. Źródła `evidence/alpha3-final-validation-source.json`. Domyślny publiczny JWK JEST POPRAWNY i ten sam co na bazie; błędny regex diagnostyczny odczytał kty zamiast y. Nie rotować klucza. Nowa bramka sprawdza publiczny punkt P-256/fingerprint i zgodność paczki; właściciel nadal buduje z własnym lokalnym kluczem. Dalej commit/push czystego kodu, CI, tagalpha3 tylko po bramkach, release przez istniejący workflow i pobranie/weryfikacja realnych artefaktów. Nie przepisywać tagaalpha2. Nadal A–C BLOCKED, braki modelu/grafiki/konfiguracji/implementacji mają odrębny status. Nie ogłaszać pełnego10/10 ani pracy po zakończeniu sesji.

# Aktualizacja stanu — alpha.3

Runtime alpha.3 jest gotowy do commitu i publikacji po rzeczywistych bramkach. Pełna regresja3091/3091PASS, lintPASS; source manifest evidence/alpha3-validation-source.json. Optymalizacja predictionLedger zachowuje dane (95testów i163porównania), lokalnie mediana281,4→30,6ms; nie zmieniono progu3000ms. Dowód ledger-performance.json. Wersje package/lock/Android oraz docs/workflow asset wskazująalpha.3.

Tagalpha.2 ->b436 istnieje i NIE wolno go przepisywać. UbuntuCI42130379821FAIL3201ms>3000, brakRelease. BranchTestsb436PASS; wcześniejszy9fTestsFAIL bez znanej przyczyny jest zachowany. Teraz commit/pushalpha3, cleanreleasebuild, nowy rzeczywistyCI, nowytagalpha3 iRelease tylko po bramkach. Następnie pobrać9artefaktów i sprawdzić sumy/źródła/metadane. API GitHub403 nadal blokuje bezpośredni PR, nie obchodzić sieci. Nie publikować kluczy/profili ani wyłączać sandboxa. Ostatni qa:desktop9f PASS niezależne funkcje/licencja; A/B/C BLOCKED brakOllamy iDISPLAY. Wszystkie G1–G10 nadal mają jawne ograniczenia; nie deklarować ukończenia całego promptu.

Poniższy checkpointalpha.2 pozostaje historią i nie zastępuje aktualizacji powyżej.

# Bieżące wznowienie — alpha.2

Baza `fb17f9755faad72295cb125563ba2b0220d9319d`, gałąź `codex/skills-integration-20261105`. Zamrożony commit runtime `9f5f9afc868421a0b80197c6d1dd84483833de85` został wysłany i potwierdzony przez ls-remote. Zachowane wszystkie wcześniejsze poprawki. Autoryzacja obejmuje commit/push dedykowanej gałęzi, PR, istniejące CI, tag i prerelease. Bez merge main/force-push/Xvfb/wyłączania sandboxa/licencji/usług systemowych/model downloads i realnych testowych odbiorców.

Pełna regresja po poprawce granicy przeglądarki:3089/3089 PASS,373 pliki,0skip; wymagane rzeczywiste bwrap/Chromium, lintPASS. Dowód `evidence/alpha2-release-validation-source.json`. `browser-transaction-boundary.json` zachowuje23focusedPASS i realne reprodukcje przed poprawką: stary GET szkicu przejmował zgodę, HTTPredirect docierał poza grant, odmowa błędnie zwracałaoktrue. Teraz pojedyncza main-frame nawigacja, blokowanie tła/ramki, CDP response guard, jawna odmowa i niepewny skutek. Nie zmieniać asercji w celu ukrywania błędów.

Paczki9f5 zbudowane i niezależnie sprawdzone (`evidence/alpha2-packages-9f5f9af.json`). Ich browser-session.cjs ma SHA2569cb2e237e11040de285bb0296980587f53e963e86bc5fb3ed022ffcf6d6f8ab2. Native launch z nowym profilem i sandboxem nadal BLOCKED brakDISPLAY. qa:desktop ostatni run niezależna komenda/ustawienia/restart/licencjaPASS; A/B/C BLOCKED, brakOllamy11435/11434 i grafiki. To nie test komputera użytkownika.

Tag v2.1.0-alpha.2 jeszcze NIE opublikowany. CI9f5: Ubuntu Verify sourcePASS i pakowanie; Tests42128885064 FAIL bez widocznych publicznie szczegółów (pełne logi wymagają sign-in), Android42128885014 FAIL brak zatwierdzonej konfiguracji podpisu. Agent installer przygotowuje tylko diagnostykę istniejącego test.yml: JSON Vitest i publiczna adnotacja nazwy błędu/exitcode, z zachowaniem oryginalnego niezerowego wyniku. Następne: sprawdzić patch, commit/push, odczytać nowy rzeczywisty CI i naprawić konkretny błąd, jeśli ujawniony. Bez zgadywania przyczyny i bez ślepych powtórzeń do zielonego wyniku. Ubuntu tag workflow opublikuje prerelease dopiero po własnych testach/lincie/pakowaniu. Po prawdziwym Release pobrać wszystkiepliki i zweryfikować sumy/commit/poprawkę, zapisać końcowy delivery i manifest zmian.

Bezpośrednie GitHub API nadal403 z polityki sieci. PR nie powstał, tag/Release nie są automatycznie dowiedzione przez push. Normalny istniejący workflow publikacji jest autoryzowany; nie tworzyć tunelu do zabronionego API ani przepisywać tagów. Własny lokalny wystawca użytkownika wymaga budowania źródeł przez install:local z istniejącym kluczem (komenda w docs/WYDANIE-ALPHA.md); paczki CI używają publicznego wystawcy repozytorium.

G1–G10 pozostają niezaliczone. MISSING_IMPLEMENTATION to m.in. pełne dowolne plany bez renderera, adapter rynku Allegro, dokumenty/Wayland i pełny UX. Osobno brak konfiguracji realnych usług/modelu/urządzeń, Android identity i pełny audit32. Nie nazywać wszystkich braków brakiem pulpitu ani lokalnych3089 testów dowodem autonomii. Nie deklarować pracy po zakończeniu sesji.

## Historia alpha.1

# Wznowienie trwałej autonomii

Gałąź integracyjna: `codex/durable-autonomy-20261105`; baza: `f74705166e484f9fe76a9ecac7212a45376254ba`. Nie wracać do 155a2e1 ani b3234ca. Nie stosować reset/clean/stash; współdzielone drzewo zawiera prace kilku niezależnych agentów.

Specyfikacja aktualnego polecenia ma sumę SHA-256 w requirements.json. Upoważnia do dedykowanej gałęzi, commit/push, PR, istniejącego CI, tagu i GitHub Release z bezpiecznymi artefaktami. Poprzednie zakazy push/publikacji zostały w tym zakresie zastąpione. Nadal nie instalować ani nie uruchamiać Xvfb, nie wyłączać sandboxa/licencji, nie wykonywać force-push, płatnych operacji, zakupów i kontaktów z prawdziwymi sprzedawcami.

Jeden rejestr: requirements.json. Stare results60.json pozostaje historią ze stabilnymi ID. Nie awansować testów bez rzeczywistych dowodów. NOT_RUN nie jest PASS, brak implementacji nie jest brakiem modelu. Testy kontrolowanego źródła nie zastępują prawdziwego modelu ani Allegro.

Zakresy prac: durable_runtime — electron/goal-service.cjs i testy; monitor_bridge — main/preload/desktop/tools/GoalStatusPanel i STOP; model_capabilities — adapter/proby Ollamy i selektor; desktop_acceptance — istniejący runner A–D; release_preflight — wersja/pakiety/build; root integruje i publikuje. Kod tych obszarów został zintegrowany. Pełna końcowa regresja2976PASS/0FAIL w364plikach, lint/buildPASS. Dowody w evidence/. Rzeczywisty katalog źródłowy sprawdzono ponownie na goal-service.cjs SHA25699b61227d1da54048d6be7f3377778e8ba72d849a0f079067887ee8708e4f8d1.

Następne kroki: odczytać git status, końcowy raport i manifest koordynatora; sprawdzić staged skan sekretów, zatwierdzić kod; z czystego SHA wykonać `npm run release:linux` i zachować jego PROVENANCE/SHA256SUMS; sprawdzić rzeczywiste paczki; wykonać autoryzowany push i dostępne kroki PR/tag/prerelease. API obecnie odmawia CONNECT403 (publication-access.json), szkic polityki wymaga aktywacji. Nie przedstawiać źródłowego ZIP jako instalatora. Wyniki pakowania po commitcie będą poza tym commitem w artefaktach przekazania; ich istnienie i adresy trzeba sprawdzić, nie założyć.

Test A/B/C rzeczywistego modelu/pulpitu BLOCKED: brak obu API Ollamy, sesji X i xdotool. C runner IMPLEMENTED; Wayland input MISSING_IMPLEMENTATION. Odnotowany realny runner poprzedza ostatnie poprawki fokusu/odpowiedzi; ich testy unit i finalna regresja przeszły, lecz natywny odbiór nadal nie został wykonany. Nie deklarować lokalnej instalacji użytkownika.

Otwarte luki produktu są wymienione w REPORT.md i capabilities[].limitations. Nie deklarować kompletnych 80 przykładów ani generalizacji modelu na podstawie samych testów selektora.

## Końcowe przekazanie kodu i paczek

Commit kodu i obu paczek: `e295f95e3a867de67a8aedb94f1452e0b92cf21c`, tag `v2.1.0-alpha.1`, wersja `2.1.0-alpha.1`. Gałąź `codex/durable-autonomy-20261105` zawiera dodatkowo późniejszy checkpoint wyłącznie dowodów/dokumentacji; produkt w tagu i paczkach nie zmienił się. Kod oraz tag zostały wysłane i potwierdzone przez ls-remote. Zbudowano rzeczywiste .deb i AppImage; ich rozpakowane app.asar są identyczne, SHA i wymagana licencja poprawne. Dowód: `PACKAGES-VERIFICATION.json`, sumy `SHA256SUMS`. Natywny plik z .deb faktycznie uruchomiono z oddzielnym profilem i sandboxem: BLOCKED po braku X/DISPLAY. Nie wykonano instalacji systemowej ani testu komputera użytkownika.

Ponowny qa:desktop na czystym e295f95: niezależny UI/komenda/ustawienia/restart/licencja PASS; A/B/C BLOCKED, kod2. Dowody w `evidence/final-desktop/`. GitHub Actions: Tests PASS (42116504054), Ubuntu PASS (42116503962); Android i Android v2 FAIL (42116503997 i42116503906), dokładne przyczyny nieustalone bez pełnych logów. Nie utożsamiać ich z lokalnym brakiem SDK.

PR create zwrócił GraphQL Forbidden, Release create zwrócił HEAD API Forbidden. PR ani Release nie powstały; brak URL wydania. Szczegóły w `delivery.json`. Szkic środowiska z api.github.com/uploads.github.com oraz dokumentacją/API Allegro zapisano, ale nie aktywowano. Następna czynność zewnętrzna: przejrzeć/zapisać ustawienia i opublikować środowisko, sprawdzić API, następnie wykorzystać istniejący tag i rzeczywiste artefakty do prerelease, pobrać opublikowane paczki i porównać sumy. Nie generować nowego klucza licencji, nie resetować tagu ani nie force-pushować.

Pełny cel nadal nie jest zakończony. Braki implementacji pozostają w requirements.json, niezależnie od powyższych blokad. Dalszy kod: kalendarzowe wyzwalacze i ogólny wykonawca bez renderera, prawdziwy adapter źródeł ofert, brakujące integracje/izolacja oraz odbiór rzeczywistym modelem i pulpitem. Nie deklarować pracy po zakończeniu sesji.
