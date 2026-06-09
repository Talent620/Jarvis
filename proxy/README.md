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

> Token sync to po prostu Twoja prywatna nazwa przestrzeni danych w KV — trzymaj go w tajemnicy;
> każdy, kto go zna, ma dostęp do Twoich zsynchronizowanych danych.
