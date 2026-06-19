# Refleks i Kora — dwubiegowy mózg JARVIS-a

Przewodnik użytkownika po lokalnym (prywatnym) trybie myślenia. **Wszystko jest opt-in** —
domyślnie JARVIS działa jak dotąd, a poniższe opcje włączasz świadomie w **⚙ Ustawienia → AI**.

## Idea w jednym akapicie
JARVIS myśli dwiema prędkościami. **Refleks** to model **lokalny** (Ollama na Twoim PC, albo
WebLLM w przeglądarce) — odpowiada od ręki, prywatnie i za darmo. **Kora** to modele w **chmurze**
(Claude, Gemini, Groq…) — wolniejsze i płatne, ale mocniejsze przy trudnych zadaniach. Nad nimi
stoi arbiter, który decyduje, kto ma odpowiedzieć i kiedy warto eskalować z Refleksu do Kory.
Cel: szybkość i prywatność na co dzień, moc chmury tylko wtedy, gdy realnie potrzebna.

## Zanim zaczniesz — uruchom Refleks (Ollama)
1. Zainstaluj **Ollama** na komputerze w tej samej sieci (Windows/macOS/Linux). Gotowy skrypt:
   `server/ollama/` (README + `docker-compose.yml` + `setup.ps1` dla Windows).
2. Pobierz model dopasowany do ~4 GB VRAM, np. `ollama pull qwen3.5:4b`.
3. W aplikacji: **⚙ → AI** wybierz dostawcę **„Lokalny model (Ollama)"** i wpisz adres serwera,
   np. `http://192.168.0.10:11434`. JARVIS sam wykryje pobrane modele (`/api/tags`) — wybierz z listy.
4. (Telefon) najprościej dosięgnąć PC przez **Tailscale** — patrz `server/ollama/README.md`.

Katalog modeli pod małe karty (2026): `qwen3.5:4b` (domyślny), `phi4-mini`, `gemma3:4b-it-qat`
(wizja), `llama3.2:3b`, `qwen3:1.7b`, `gemma2:2b`, `deepseek-r1:1.5b`, `qwen2.5-coder:3b`.

## Przełączniki (⚙ → AI → „🧠 Refleks i Kora")
Wszystkie domyślnie **wyłączone**; wymagają skonfigurowanej Ollamy.

| Opcja | Co robi | Kiedy włączyć |
|---|---|---|
| **⚡ Lokalnie najpierw dla prostych pytań** (`localFirstSimple`) | Krótkie/proste pytania idą najpierw do Refleksu; chmura zostaje w rezerwie. Offline → lokalny start automatycznie. | Chcesz szybsze, prywatne odpowiedzi na drobne pytania. |
| **🚪 Brama Pewności** (`confidenceGate` + suwak `confidenceThreshold`) | Gdy odpowiedź lokalna jest niepewna (zgadywanie, „nie wiem", urwana), JARVIS sam dopytuje Korę i zwraca lepszą wersję. Lokalny wynik zostaje deską ratunku, gdyby chmura padła. | Chcesz lokalnej szybkości bez utraty jakości przy trudniejszych pytaniach. |
| **🔮 Spekulacja** (`speculativeMode`) | Przy złożonych pytaniach Refleks pokazuje szybki **szkic**, a Kora równolegle go weryfikuje i poprawia **tylko**, gdy odpowiedzi istotnie się różnią. | Chcesz natychmiast widzieć tekst, a poprawkę tylko gdy potrzebna. |
| **⚖ Konsylium hybrydowe** (`councilIncludeLocal`) | W „Trybie Konsylium" dorzuca Refleks jako dodatkowy, prywatny głos obok modeli z chmury. | Używasz Konsylium i chcesz mieć w naradzie lokalny głos. |
| **📈 Router, który się uczy** (`adaptiveRouter`) | JARVIS zapamiętuje **lokalnie**, które ścieżki sprawdzają się dla danego typu pytań, i dostraja próg eskalacji (Refleks wiarygodny → niższy próg; słaby → wyższy). | Chcesz, by system poprawiał trafność trasowania z czasem. |
| **🔥 Prewarm** (`prewarmLocal`) | Po starcie i powrocie do aplikacji wstępnie ładuje model do pamięci serwera, by pierwsza odpowiedź nie czekała na rozgrzewkę. Throttlowane (≤1/min). | Drażni Cię „cold start" pierwszego pytania. |
| **Okno kontekstu** (`ollamaNumCtx`) | Rozmiar `num_ctx` Ollamy (2k–16k). Większe = dłuższa pamięć rozmowy, ale więcej VRAM i wolniej. | Dostrajasz do swojej karty graficznej. |
| **Warstwy na GPU** (`ollamaNumGpu`) | `num_gpu`: `-1` = auto. Zmniejsz, jeśli model nie mieści się w VRAM (część warstw trafi na CPU). | Model nie wchodzi w pamięć GPU. |

## Podgląd „🧭 Mózg na żywo" (diagnostyka)
W tej samej sekcji znajdziesz zwijany podgląd **ostatnich decyzji routera**: co poszło do Refleksu,
co do Kory, czy nastąpiła eskalacja, jak szybko (latencja) i z jaką pewnością. Wszystko liczone i
trzymane **wyłącznie lokalnie** — nic nie wychodzi do chmury. Zbiorcze statystyki (skuteczność tras,
mediana latencji per typ/warstwa) zobaczysz też w **🩺 Stan systemu**.

## Prywatność
- **🔒 Tryb on-device** (`onDeviceOnly`): twarda blokada chmury — JARVIS używa wyłącznie modelu
  lokalnego, web-search wyłączony, nic nie opuszcza urządzenia.
- **🛡 Tryb Prywatny**: jednym kliknięciem wykrywa lokalny model i przełącza całość na on-device.
- Refleks działa **offline**. Bez sieci proste zapytania i tak trafią najpierw do modelu lokalnego.

## Dalej (server-only)
- `server/ollama/` — postawienie serwera Ollama (PC) + dostęp z telefonu (Tailscale).
- `server/lora/` — szkielet fine-tuningu LoRA „Twój głos lokalnie" (po stronie serwera z GPU;
  anonimizacja PII, eksport adaptera do Ollamy). To plan pod upgrade sprzętu, nie wymóg.
