# JARVIS backend-proxy

Lekki proxy do dwóch celów:

1. **Omija CORS** — NVIDIA NIM i GitHub Models (a czasem Home Assistant) blokują
   zapytania prosto z przeglądarki. Proxy przekazuje je z właściwymi nagłówkami.
2. **Chowa klucze API** — jeśli ustawisz sekrety środowiskowe, klient nie musi
   znać kluczy; trzyma je serwer. To zalecane przy dystrybucji aplikacji.

## Wdrożenie na Cloudflare Workers (darmowe)

```bash
npm install -g wrangler
wrangler login
cd proxy
wrangler deploy worker.js --name jarvis-proxy
```

Następnie (opcjonalnie) dodaj sekrety, by ukryć klucze:

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put OPENROUTER_API_KEY
wrangler secret put NVIDIA_API_KEY
wrangler secret put GITHUB_MODELS_TOKEN
```

W aplikacji JARVIS: **⚙ Ustawienia → Backend-proxy** wpisz adres workera, np.
`https://jarvis-proxy.twoj-subdomena.workers.dev`.

> Jeśli ustawisz sekrety w proxy, w aplikacji możesz zostawić pola kluczy puste —
> wystarczy wpisać dowolny niepusty placeholder, żeby tryb auto wybrał dostawcę,
> a prawdziwy klucz doda proxy. (Dla pełnego ukrycia kluczy rozważ wariant, w
> którym klient nie wysyła żadnego klucza — patrz komentarze w `worker.js`.)

## Trasy

| Trasa | Cel |
|---|---|
| `POST /anthropic` | Claude Messages API |
| `POST /openai?u=<url>` | Dostawcy zgodni z OpenAI (Groq, OpenRouter, NVIDIA, GitHub) |
| `POST /gemini?model=<model>` | Google Gemini |
| `POST /passthrough?u=<url>` | Dowolny URL, np. Twój Home Assistant |
