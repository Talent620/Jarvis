# Aktualizacja działającego runtime na Linuksie

`bash scripts/install-runtime.sh` aktualizuje lokalny serwer i sprawdza rzeczywiście działającą wersję oraz wymagane możliwości API. Sam kod HTTP 200 ze starszego procesu nie oznacza już udanej aktualizacji.

Instalator sprawdza prywatne pliki discovery, token, stan i blokadę, tożsamość serwera oraz katalog danych procesu. Działającą usługę systemd identyfikuje także przez jej PID. Zachowuje kod poprzedniego runtime, zatrzymuje zweryfikowaną instancję, czeka na zwolnienie blokady i uruchamia nową. Bez systemd startuje odłączony proces z prywatnym logiem. Token, `serverId`, profil i zapisane zadania pozostają zachowane. Nie uruchamia testu jakości modelu.

Jeżeli nowa wersja nie ruszy, przywraca poprzednie pliki i próbuje uruchomić poprzedni serwer. Snapshot kodu pozostaje wtedy w `runtime-releases/rollback.*`. Dopasowanie zachowanej generacji opiera się na wersji modułu; przy kilku rewizjach z identycznym numerem wersji nie gwarantuje odtworzenia identycznego commita. Najpierw wybierany jest czytelny katalog kodu działającego procesu.

`--no-start` tylko instaluje pliki: nie zatrzymuje działającego procesu. Po takiej instalacji do przełączenia wersji trzeba uruchomić instalator ponownie bez tej opcji.

Stare, samodzielne AppImage może pozostawić działający runtime po usunięciu katalogu ekstrakcji. Jeśli nie ma już czytelnego starego kodu ani zachowanej generacji, instalator odmawia jego zatrzymania — nie może zapewnić rollbacku. Wtedy świadomie zatrzymaj stary serwer przez zainstalowane `jarvis-runtime stop` albo `npm run runtime -- stop` z katalogu projektu i ponów instalację. Przy niestandardowym katalogu danych użyj tego samego `JARVIS_RUNTIME_DATA_DIR`. Samo otwarcie nowszego AppImage może ponownie wykorzystać starszy działający proces.

## Regresja aktualizacji

```bash
npm run test:runtime-upgrade
```

Test uruchamia prawdziwe stare i nowe procesy runtime, z izolowanymi katalogami i atrapą `systemctl`. Nie zmienia rzeczywistych usług użytkownika i nie korzysta z modelu. Sprawdza aktualizację z procesów odłączonych i systemd, `--no-start`, rollback oraz odmowę zatrzymania obcej instancji.

Domyślnym źródłem starej wersji jest lokalny commit `857def1` (runtime 0.1.0). W płytkim lub scalonym repozytorium podaj zachowany katalog starego kodu:

```bash
npm run test:runtime-upgrade -- --old-runtime-source /ścieżka/do/starego/server/runtime
```

Można też jawnie wybrać dostępny lokalnie commit przez `--baseline-ref`. Brak źródeł starej wersji kończy test błędem z instrukcją, a nie cichym pominięciem. Test wymaga Linuksa, Node.js 20+, zwykłego użytkownika i dostępu do loopback. Nie jest automatycznie dodany do CI, ponieważ checkout nie musi zawierać historii starego runtime.
