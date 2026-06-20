# 🆓 Najlepsze darmowe API dla JARVISA (research 2026)

Krótki, praktyczny przegląd darmowych API, które **idealnie pasują** do JARVISA — z aktualnymi
limitami (2026) i konkretną rekomendacją „co wziąć". Wszystkie poniższe **nie wymagają karty**.

> Wniosek na start: JARVIS **już ma wbudowane 7 najlepszych darmowych dostawców LLM**. Nie trzeba
> nic dodawać — wystarczy wkleić 1–3 klucze w ⚙ → AI → 🔑 Klucze API. Tryb **Auto** sam użyje
> najlepszego dostępnego (priorytet: jakość → szybkość).

## 🥇 Rekomendowany darmowy zestaw (bez karty, 5 minut)

Dla 99% ludzi wystarczą **dwa–trzy** klucze — JARVIS rotuje je i dobiera automatycznie:

1. **Google Gemini (AI Studio)** — *najlepszy darmowy ogólny + #1 tool-calling.*
   `aistudio.google.com/apikey` · 15 RPM / 1500 zapytań dziennie (Flash). Bez karty.
2. **Cerebras** — *największy dzienny limit + ekstremalna szybkość (~2000 tok/s).*
   `cloud.cerebras.ai` · 30 RPM / 14 400 RPD / 60k TPM. Bez karty.
3. **Groq** — *błyskawiczny (300–500 tok/s), świetny do rozmowy na żywo.*
   `console.groq.com` · 30 RPM / ~1000–14 400 RPD (zależnie od modelu). Bez karty.

> Wklej te trzy → w trybie **Auto** JARVIS użyje Gemini do jakości/narzędzi, a Cerebras/Groq do
> szybkich odpowiedzi i głosu. To pokrywa właściwie cały codzienny użytek za darmo.

## 📋 Pełna lista wbudowanych darmowych dostawców (✓ = już w JARVISIE)

| Dostawca | W JARVISIE | Karta? | OpenAI-compat | Limity (free, 2026) | Najlepsze za darmo |
|---|---|---|---|---|---|
| **Google Gemini** | ✓ | nie | tak | 15 RPM / 1500 RPD (Flash) | Gemini 2.5 Flash (tool-calling), 2.5 Pro (50/dzień) |
| **Cerebras** | ✓ | nie | tak | 30 RPM / 14 400 RPD / 60k TPM | Llama 3.3 70B, Qwen3 235B |
| **Groq** | ✓ | nie | tak | 30 RPM / ~1000 RPD | Llama 4 Scout, Kimi K2, Llama 3.3 70B |
| **Mistral** | ✓ | nie | tak | 1 req/s / 1 mld tokenów/mies. | Mistral Large/Small, Pixtral (wizja) |
| **Cohere** | ✓ | nie | tak\* | 20 RPM / 1000 zapytań/mies. | Command A / R+ / R / R7B (function calling) |
| **OpenRouter** | ✓ | nie | tak | 20 RPM / ~200 RPD | DeepSeek R1/V3, Dolphin (bez cenzury), Llama 70B |
| **NVIDIA NIM** | ✓ | nie* | tak | ~40 RPM (kredyty) | DeepSeek R1/V3, Llama 3.3 70B |
| **GitHub Models** | ✓ | nie* | tak | 10–15 RPM / 50–150 RPD | GPT-4o/4.1, DeepSeek-R1, Llama 70B |
| **Ollama (lokalnie)** | ✓ | — | — | bez limitów, offline | dowolny model, też bez cenzury |

\* NVIDIA wymaga numeru telefonu; GitHub — konta GitHub.

## 🧩 Warte rozważenia (opcjonalne, marginalne)

- **Cohere** — ✓ **dodane** (`dashboard.cohere.com/api-keys`). 20 RPM / 1000 zapytań/mies., modele
  Command A / R+ / R / R7B, function calling. Wybierz „Cohere Command" w ⚙ → AI lub zostaw Auto.
  Idzie przez proxy/desktop (Cohere bez CORS dla przeglądarki).
- **Cloudflare Workers AI** — 10 000 „neuronów"/dzień; wymaga `account_id` w adresie (nie pasuje do
  prostego wzorca klucza), więc poza zakresem.
- **Hugging Face Serverless** — tylko ~$0.10 kredytów/mies.; za mało do realnego użytku.

## 🔎🖼🗣 Darmowe API poza LLM (też wbudowane)

- **Research z cytatami → Tavily** (`tavily.com`): 1000 zapytań/mies. za darmo (⚙ → AI → 🔎 Research).
- **Obrazy → Pollinations** (bez klucza, w pełni darmowe) + **Gemini Nano Banana** (edycja zdjęć na
  kluczu Gemini). Lokalnie: **Stable Diffusion** (A1111/Forge) — za darmo, offline.
- **Głos → Gemini TTS** (darmowy, na kluczu Gemini) lub **systemowy/lokalny (Kokoro)** — offline.
- **Leady/firmy → OpenStreetMap (Overpass)**: darmowe, bez klucza (Pulpit sprzedaży).

## ⚙ Jak to ustawić w JARVISIE

1. ⚙ → zakładka **🤖 AI** → wpisz w wyszukiwarce „klucze" (albo otwórz **🔑 Klucze API**).
2. Wklej 1–3 klucze (najlepiej Gemini + Cerebras + Groq). Przy każdym dostawcy jest link do
   darmowego klucza.
3. Zostaw **Dostawca: ⚡ Auto** — JARVIS dobierze najlepszy dostępny. Na liście widać „✓ gotowy"
   przy tych z kluczem.
4. (Opcjonalnie) Tryb **🎛 pracy** → „Szybki" dla rozmowy na żywo, „Mądry" do trudnych zadań.

---
*Limity bywają korygowane przez dostawców — traktuj liczby orientacyjnie. Stan: 2026.*
