# JARVIS BFF (backend)

Lekki backend na **Cloudflare Workers** (darmowy tier wystarcza do użytku osobistego).
Trzy role:

1. **Proxy kluczy / CORS** — NVIDIA NIM i GitHub Models blokują zapytania z przeglądarki;
   proxy je przekazuje i może ukryć klucze API po stronie serwera.
2. **Research + embeddings** — `/v1/search` (Tavily) i `/v1/embed` (Gemini) z kluczami na serwerze.
3. **Synchronizacja** — `/v1/sync` zapisuje/odczytuje dane (pamięć, projekty, sceny) w KV,
   dzięki czemu współdzielisz je między urządzeniami.

## Wdrożenie — jedną komendą (zalecane)

Potrzebujesz tylko **Node.js** i darmowego konta **Cloudflare**:

```bash
cd proxy
node setup.mjs
```

**Kreator `setup.mjs`** prowadzi przez CAŁOŚĆ krok po kroku (Windows/macOS/Linux):
logowanie do Cloudflare → utworzenie bazy KV → wdrożenie → pokazuje dokładny
„redirect URI" do wklejenia w Google Cloud Console i czeka → przyjmuje Client
ID/Secret → ustawia sekrety → wdraża ponownie → wypisuje gotowy adres i losowy
token sync. To najłatwiejsza droga do wysyłki Gmailem z telefonu.

### Albo: skrypt bez pytań (gdy znasz już klucze)

```bash
cd proxy
# opcjonalnie podaj klucze od razu (utworzą się jako sekrety):
GEMINI_API_KEY=... TAVILY_API_KEY=... bash deploy.sh
```

Skrypt sam: zaloguje do Cloudflare, utworzy namespace KV, wstawi jego id do
`wrangler.toml`, ustawi podane sekrety i wdroży workera. Na końcu wypisze adres
(np. `https://jarvis-bff.twoja.workers.dev`).

### Albo ręcznie

```bash
npm install -g wrangler
wrangler login
cd proxy
wrangler kv namespace create JARVIS_KV   # wstaw zwrócone id do wrangler.toml
wrangler secret put GEMINI_API_KEY        # i inne, których chcesz użyć
wrangler deploy
```

### Integracje Google (Gmail + Kalendarz) — opcjonalnie

1. W [Google Cloud Console](https://console.cloud.google.com) utwórz „OAuth client ID"
   (typ: Web). Jako **Authorized redirect URI** wpisz:
   `https://jarvis-bff.twoja.workers.dev/v1/google/callback`.
2. Ustaw sekrety: `wrangler secret put GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_SECRET`.
3. W aplikacji: ⚙ → Integracje Google → Połącz konto.

> Po wdrożeniu otwórz adres workera w przeglądarce — powinno pokazać
> `{"ok":true,...}`. W aplikacji użyj **⚙ → 🔌 Testuj backend**.

Adres workera (np. `https://jarvis-bff.twoja-subdomena.workers.dev`) wpisz w aplikacji:
- **⚙ → Backend-proxy** — dla proxy kluczy AI,
- **⚙ → Synchronizacja** — ten sam adres + dowolny **token sync** (Twój prywatny klucz przestrzeni danych).

## Trasy

| Trasa | Metoda | Opis |
|---|---|---|
| `/anthropic` | POST | Claude Messages API |
| `/gemini?model=` | POST | Gemini generateContent |
| `/openai?u=` | POST | Groq/OpenRouter/NVIDIA/GitHub (biała lista) |
| `/passthrough?u=` | POST | dowolny URL (np. Home Assistant) |
| `/v1/search` | POST | research z cytatami (Tavily) |
| `/v1/embed` | POST | embeddingi (Gemini text-embedding-004) |
| `/v1/sync` | GET/POST | synchronizacja danych (Bearer = token sync) |
| `/v1/smtp/send` | POST | przekaźnik SMTP — telefon wysyła e-mail hasłem aplikacji, bez Google OAuth (Bearer = token sync) |
| `/v1/smtp/verify` | POST | sprawdzenie logowania SMTP bez wysyłki (Bearer = token sync) |

> **Wysyłka e-maili z telefonu „w tle" — najprościej (bez Google).** Po wdrożeniu backendu
> wystarczy w aplikacji: ⚙ → Poczta (adres Gmail + hasło aplikacji) oraz ⚙ → Synchronizacja
> (adres backendu + token). Telefon wysyła wtedy przez `/v1/smtp/send` — jeden klik, bez
> otwierania Gmaila i bez konfiguracji OAuth. (Pełne OAuth potrzebne tylko do czytania skrzynki/Kalendarza.)

> Token sync to po prostu Twoja prywatna nazwa przestrzeni danych w KV — trzymaj go w tajemnicy;
> każdy, kto go zna, ma dostęp do Twoich zsynchronizowanych danych.

## Licencje + panel administracyjny (kto korzysta)

Worker pełni też rolę serwera licencji z panelem admina pod `/admin`.

### Konfiguracja (jednorazowo)
```bash
# 1) Twój klucz prywatny do wydawania licencji (ten z czatu, jako jedna linia JSON):
wrangler secret put LICENSE_PRIVATE_JWK
# 2) Hasło Twojego konta administratora:
wrangler secret put ADMIN_TOKEN
wrangler deploy
```
Klucz publiczny jest już wbudowany w aplikację (`src/lib/license.ts`) i w Workerze —
muszą być z tej samej pary (są).

### Włączenie egzekwowania online w aplikacji (build)
Ustaw w GitHub Secrets repo:
- `JARVIS_LICENSE_URL` = adres Workera, np. `https://jarvis-bff.twojekonto.workers.dev`
- `JARVIS_LICENSE_STRICT` = `true`  (wymaga aktywacji online: limit urządzeń, zdalne unieważnianie)

Bez `JARVIS_LICENSE_URL` aplikacja działa w trybie offline (sam podpis ECDSA — bez limitu urządzeń i podglądu).

### Panel administratora
Wejdź na `https://<twój-worker>/admin`, zaloguj się tokenem `ADMIN_TOKEN`. Możesz:
- **wydać klucz** (imię klienta, ważność w dniach, limit urządzeń),
- zobaczyć **kto korzysta** — urządzenia i ostatnią aktywność każdej licencji,
- **unieważnić / przywrócić** licencję (działa zdalnie przy następnym sprawdzeniu),
- **zresetować urządzenia** (gdy klient zmienia telefon).

### Endpunkty
- `POST /v1/license/activate` `{key, device, platform}` → aktywacja + rejestracja urządzenia
- `POST /v1/license/check` `{key, device, platform}` → heartbeat + zdalne unieważnienie
- `GET /v1/admin/list`, `POST /v1/admin/issue|revoke|reset-devices` (nagłówek `x-admin-token`)
