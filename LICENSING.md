# JARVIS — klucze licencyjne (offline, Ed25519)

System aktywacji aplikacji **kluczem licencyjnym**, działający **bez serwera**. Klucze są
podpisywane kryptograficznie (Ed25519). Aplikacja iOS ma wbudowany tylko klucz **publiczny**
i weryfikuje podpis offline — Ty generujesz klucze swoim kluczem **prywatnym**.

> Stan wyjściowy: w istniejącej aplikacji JARVIS (APK/EXE) **nie ma** żadnego licencjonowania —
> jedyne „klucze" w kodzie to klucze API (Groq, Picovoice). Ten system dokłada brakującą warstwę.

## Jak to działa

```
                 (Ty, raz)                         (Ty, dla każdego klienta)
  genkeys ──► license-private.pem  ──►  issue --name "X" ──►  token: xxxxx.yyyyy
              + klucz publiczny                                      │
              wbudowany w aplikację                                  ▼
                                                   użytkownik wkleja token w apce
                                                   ──► weryfikacja podpisu offline ──► odblokowane
```

- **Token licencyjny** = `base64url(payload)` + `.` + `base64url(podpis)`
  gdzie `payload = {"n":"imię/email","exp":<unix s, 0=bezterminowo>,"f":["pro"]}`
- Aplikacja sprawdza podpis kluczem publicznym (Ed25519, `CryptoKit`) i datę ważności.
- Po udanej aktywacji token jest zapisywany na urządzeniu (UserDefaults) — gate pojawia się
  tylko do pierwszej poprawnej aktywacji.

## Włączenie licencjonowania (krok po kroku)

1. **Wygeneruj parę kluczy** (raz):
   ```bash
   npm run license:genkeys
   ```
   - tworzy `license-private.pem` — **TRZYMAJ W TAJEMNICY, nie commituj** (jest w `.gitignore`),
   - wstrzykuje klucz **publiczny** do `ios/App/App/AppDelegate.swift` (pole `LicenseConfig.publicKeyBase64`).
   - Od tej chwili (po przebudowaniu) aplikacja **wymaga** klucza.

2. **Zbuduj aplikację** — push do repo uruchomi CI; nowy `.ipa` będzie miał włączoną bramkę aktywacji.

3. **Wystaw klucz dla użytkownika**:
   ```bash
   npm run license:issue -- --name "jan@example.com"            # bezterminowy
   npm run license:issue -- --name "Firma X" --days 365         # ważny rok
   npm run license:issue -- --name "Tester" --days 30 --features pro,beta
   ```
   Wynikowy token przekazujesz użytkownikowi (np. mailem). On wkleja go w ekranie aktywacji.

4. **Sprawdzenie tokenu** (opcjonalnie):
   ```bash
   npm run license:verify -- "<token>"
   ```

## Ekran aktywacji

Przy starcie, jeśli licencjonowanie jest włączone i urządzenie nie jest aktywowane, JARVIS pokazuje
ekran „Aktywacja — wklej klucz licencyjny" (w stylu HUD) **zamiast** ładować aplikację webową.
Dopiero poprawny klucz odsłania właściwą apkę. Kod: `ios/App/App/AppDelegate.swift`
(`LicenseManager`, `LicenseGateViewController`).

## Wyłączenie / reset

- Aby **wyłączyć** licencjonowanie: ustaw `LicenseConfig.publicKeyBase64 = ""` (pusty = bramka off).
- Aby **unieważnić wszystkie** dotychczasowe klucze: `npm run license:genkeys -- --force`
  (nowa para kluczy → stare tokeny przestają działać po przebudowie).

## ⚠️ Realizm bezpieczeństwa

- To zabezpieczenie **klienckie**. Kryptografia gwarantuje, że **nikt nie wygeneruje ważnego klucza
  bez Twojego klucza prywatnego**. Nie chroni jednak przed kimś, kto zmodyfikuje samą aplikację
  (usunie bramkę) — to jest niemożliwe do zatrzymania w aplikacji działającej na urządzeniu klienta.
  Taki model w zupełności wystarcza do sprzedaży/dystrybucji „dla uczciwych".
- Chcesz mocniej (unieważnianie online, limit urządzeń, ukrycie klucza Groq)? Trzeba dołożyć
  **backend** (własne API albo usługa typu Keygen/Cryptolens) — patrz opcje w rozmowie.
- Ten sam mechanizm można dołożyć w Androidzie/EXE lub w źródle React (gdy będzie dostępne) —
  format tokenu jest przenośny; w JS weryfikację robi się np. biblioteką `tweetnacl`.
