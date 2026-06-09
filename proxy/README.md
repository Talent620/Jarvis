# JARVIS BFF (backend)

Lekki backend na **Cloudflare Workers** (darmowy tier wystarcza do użytku osobistego).
Trzy role:

1. **Proxy kluczy / CORS** — NVIDIA NIM i GitHub Models blokują zapytania z przeglądarki;
   proxy je przekazuje i może ukryć klucze API po stronie serwera.
2. **Research + embeddings** — `/v1/search` (Tavily) i `/v1/embed` (Gemini) z kluczami na serwerze.
3. **Synchronizacja** — `/v1/sync` zapisuje/odczytuje dane (pamięć, projekty, sceny) w KV,
   dzięki czemu współdzielisz je między urządzeniami.

## Wdrożenie

```bash
npm install -g wrangler
wrangler login
cd proxy

# 1) utwórz namespace KV i wstaw zwrócone id do wrangler.toml (JARVIS_KV)
wrangler kv namespace create JARVIS_KV

# 2) sekrety (dowolne, których chcesz użyć)
wrangler secret put GEMINI_API_KEY
wrangler secret put TAVILY_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put OPENROUTER_API_KEY
wrangler secret put NVIDIA_API_KEY
wrangler secret put GITHUB_MODELS_TOKEN

# 3) deploy
wrangler deploy
```

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
