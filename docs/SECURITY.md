# JARVIS — Bezpieczeństwo (status i hardening)

> Stan względem AUDIT.md. Architektura: client-first PWA + Capacitor + opcjonalny Cloudflare
> Worker (BFF). Sekrety: BYOK (klucze użytkownika), szyfrowane lokalnie (AES-GCM/PBKDF2).

## ✅ Już naprawione (w kodzie)
- **CRLF / MIME injection** (SMTP) — `to/subject/inReplyTo/user` przepuszczane przez `noCRLF`.
- **Klucz Gemini w nagłówku** (`x-goog-api-key`), nie w URL (koniec wycieku przez logi/referrer).
- **SSRF — blok metadanych chmury** — `blocksCloudMetadata` blokuje `169.254.0.0/16`,
  `metadata.google.internal`, Alibaba `100.100.100.200`, AWS IPv6 `fd00:ec2::254`
  (LAN/Home Assistant nadal działa).
- **Import kopii** — whitelist pól + potwierdzenie przy zmianie adresów serwerów (anty-eksfiltracja).
- **Quota localStorage** — twarde capy kolekcji-logów + GŁOŚNY toast „brak miejsca" (koniec cichej
  utraty danych).
- **Audyt głosu/TTS** — wyciek węzłów audio naprawiony; błędy TTS logowane.

## 🔧 Hardening OPT-IN (włącz, gdy gotów — domyślnie zgodność wstecz)
- **Zero-Trust BFF (worker):** ustaw w workerze `APP_TOKEN=<sekret>` oraz `REQUIRE_APP_TOKEN=1`,
  a w kliencie `VITE_APP_TOKEN=<ten sam sekret>`. Wtedy trasy `/anthropic /openai /gemini
  /passthrough` wymagają poprawnego `x-app-token` ZAWSZE (brak konfiguracji ⇒ odrzuć), zamiast
  działać bez auth. Bez tych zmiennych worker działa jak dotąd (zgodność wstecz).
- **Zawsze potwierdzaj akcje wychodzące:** ⚙ → włącznik „🔒 Zawsze potwierdzaj akcje wychodzące"
  (`requireConsentAlways`). Wtedy e-mail/SMS/telefon/smart-home bez ekranu zgody są BLOKOWANE
  (fail-closed), także w trybie głośnomówiącym. Domyślnie wyłączone, by nie psuć flow hands-free.

## ⚠️ Ryzyka rezydualne (świadome, wymagają decyzji właściciela)
- **`admin.ts` — logowanie właściciela numerem telefonu.** `OWNER_PHONE_HASH` (SHA-256 bez soli)
  jest w bundlu; numer (~30 bitów) da się brute-force'ować offline → potencjalne przejęcie serwera
  licencji. Dotyczy WYŁĄCZNIE panelu admina/licencji (nie danych użytkownika). **Rekomendacja:**
  przejść na hasło właściciela + PBKDF2 z solą (wymaga migracji konfiguracji admina).
- **`/passthrough` — pełen allowlisting hostów.** Blok metadanych jest, ale dowolny host publiczny
  przechodzi. Pełna allowlista (tylko zaufane domeny + LAN) wymaga konfiguracji pod konkretne
  wdrożenie (Home Assistant itp.).

## Zasada
Sekrety nigdy nie trafiają do repo (skan pre-commit). Klucze użytkownika są BYOK i szyfrowane
lokalnie. Domyślne ustawienia są zgodne wstecz; twardsze tryby są opt-in, by nie zepsuć działających
wdrożeń. Znane luki są udokumentowane z mitygacją, nie ukrywane.
