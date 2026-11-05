# Wznowienie trwałej autonomii

Gałąź integracyjna: `codex/durable-autonomy-20261105`; baza: `f74705166e484f9fe76a9ecac7212a45376254ba`. Nie wracać do 155a2e1 ani b3234ca. Nie stosować reset/clean/stash; współdzielone drzewo zawiera prace kilku niezależnych agentów.

Specyfikacja aktualnego polecenia ma sumę SHA-256 w requirements.json. Upoważnia do dedykowanej gałęzi, commit/push, PR, istniejącego CI, tagu i GitHub Release z bezpiecznymi artefaktami. Poprzednie zakazy push/publikacji zostały w tym zakresie zastąpione. Nadal nie instalować ani nie uruchamiać Xvfb, nie wyłączać sandboxa/licencji, nie wykonywać force-push, płatnych operacji, zakupów i kontaktów z prawdziwymi sprzedawcami.

Jeden rejestr: requirements.json. Stare results60.json pozostaje historią ze stabilnymi ID. Nie awansować testów bez rzeczywistych dowodów. NOT_RUN nie jest PASS, brak implementacji nie jest brakiem modelu. Testy kontrolowanego źródła nie zastępują prawdziwego modelu ani Allegro.

Zakresy prac: durable_runtime — electron/goal-service.cjs i testy; monitor_bridge — main/preload/desktop/tools/GoalStatusPanel i STOP; model_capabilities — adapter/proby Ollamy i selektor; desktop_acceptance — istniejący runner A–D; release_preflight — wersja/pakiety/build; root integruje i publikuje. Kod tych obszarów został zintegrowany. Pełna końcowa regresja2976PASS/0FAIL w364plikach, lint/buildPASS. Dowody w evidence/. Rzeczywisty katalog źródłowy sprawdzono ponownie na goal-service.cjs SHA25699b61227d1da54048d6be7f3377778e8ba72d849a0f079067887ee8708e4f8d1.

Następne kroki: odczytać git status, końcowy raport i manifest koordynatora; sprawdzić staged skan sekretów, zatwierdzić kod; z czystego SHA wykonać `npm run release:linux` i zachować jego PROVENANCE/SHA256SUMS; sprawdzić rzeczywiste paczki; wykonać autoryzowany push i dostępne kroki PR/tag/prerelease. API obecnie odmawia CONNECT403 (publication-access.json), szkic polityki wymaga aktywacji. Nie przedstawiać źródłowego ZIP jako instalatora. Wyniki pakowania po commitcie będą poza tym commitem w artefaktach przekazania; ich istnienie i adresy trzeba sprawdzić, nie założyć.

Test A/B/C rzeczywistego modelu/pulpitu BLOCKED: brak obu API Ollamy, sesji X i xdotool. C runner IMPLEMENTED; Wayland input MISSING_IMPLEMENTATION. Odnotowany realny runner poprzedza ostatnie poprawki fokusu/odpowiedzi; ich testy unit i finalna regresja przeszły, lecz natywny odbiór nadal nie został wykonany. Nie deklarować lokalnej instalacji użytkownika.

Otwarte luki produktu są wymienione w REPORT.md i capabilities[].limitations. Nie deklarować kompletnych 80 przykładów ani generalizacji modelu na podstawie samych testów selektora.
