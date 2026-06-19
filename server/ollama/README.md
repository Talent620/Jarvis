# JARVIS — serwer inferencji (Ollama) na Twoim PC

„Dom jako serwer AI": PC stawia prywatny mózg (Ollama), a telefon w terenie tapuje domowe GPU.
Refleks (mały model 4B) robi szybkie/proste tury lokalnie i offline; chmura zostaje do ciężkiego
rozumowania. Nic nie wychodzi na zewnątrz, gdy używasz lokalnego modelu.

> Najprostsza ścieżka na Windows: **`JARVIS-Ollama-Server.exe`** (jedno kliknięcie — ustawia
> wszystko i daje adres). Poniżej pełny opis ręczny + warianty Linux/NAS i dostęp „w terenie".

## TL;DR — „PC włączony, używam zdalnie z telefonu (APK)"
Twój dokładny scenariusz w 4 krokach:
1. **PC (raz):** uruchom `JARVIS-Ollama-Server.exe` albo `setup.ps1`. Ustawi nasłuch+CORS, **wyłączy
   usypianie PC na zasilaniu** (serwer dostępny 24/7), pobierze komplet modeli i **wypisze gotowy adres**.
2. **Zdalny dostęp:** zainstaluj **Tailscale** na PC i telefonie (jeden tailnet, darmowy). Wtedy
   telefon dosięgnie PC z dowolnej sieci, bez otwierania portów.
3. **Telefon (APK):** ⚙ → AI → dostawca „Lokalny model (Ollama)", wklej adres `http://100.x.x.x:11434`
   (Tailscale) lub `http://192.168.x.x:11434` (ta sama WiFi), → „🔄 Odśwież modele z Ollamy".
4. **Kolejne modele dodajesz z telefonu:** w tym samym ekranie wpisz nazwę (np. `phi4-mini`) i kliknij
   **⬇ Pobierz** — ściągnie się wprost na PC, bez wracania do komputera. Model per typ zadania ustawisz
   w sekcji „🧠 Refleks i Kora".

> APK (nie PWA) jest tu najwygodniejsze: WebView dopuszcza cleartext `http://` do tailnetu/LAN, więc
> nie musisz kombinować z HTTPS. Dla PWA po `https://` → `tailscale serve https / 11434` (patrz niżej).

## 1. Windows — krok po kroku
1. Zainstaluj Ollamę: https://ollama.com
2. Ustaw nasłuch w sieci + CORS (PWA woła Ollamę z innego origin — **CORS jest krytyczny**):
   ```powershell
   setx OLLAMA_HOST "0.0.0.0:11434"
   setx OLLAMA_ORIGINS "*"
   ```
   Zrestartuj Ollamę (wyloguj/zaloguj albo zamknij ikonę w trayu i odpal `ollama serve`).
3. Pobierz modele (katalog pod ~4 GB VRAM, 2026):
   ```powershell
   ollama pull qwen3.5:4b           # główny mózg agentowy, tool-calling
   ollama pull qwen3:1.7b           # refleks: voice/parsing, błyskawiczny
   ollama pull gemma3:4b-it-qat     # multimodalny: lokalna wizja + 140 języków
   ollama pull llama3.2:3b          # szybki ogólny
   ollama pull deepseek-r1:1.5b     # łańcuch myśli / matematyka
   ollama pull qwen2.5-coder:3b     # kod lokalnie
   ```
4. W zaporze zezwól na port **11434** (sieć prywatna).

## 2. Dostęp z telefonu „w terenie"
- **Tailscale (zalecane):** zainstaluj na PC i telefonie (jeden tailnet). W JARVIS:
  `ollamaUrl = http://100.x.x.x:11434` (adres PC w tailnecie). Szyfrowane P2P, bez otwierania portów.
- **Cloudflare Tunnel + Access:** Ollama **nie ma autoryzacji** — NIE wystawiaj publicznie bez bramki
  (Cloudflare Access / token). Inaczej każdy z linkiem wydaje polecenia Twojemu GPU.

### Pułapka: mixed-content (HTTPS PWA → cleartext http)
PWA po `https://` nie połączy się z `http://100.x...:11434` (przeglądarka blokuje). Rozwiązania:
- **`tailscale serve https / 11434`** → dostajesz HTTPS po MagicDNS (`https://twoj-pc.ts.net`), wtedy PWA działa.
- **albo użyj APK** — WebView dopuszcza cleartext do tailnetu/LAN (najprostsza ścieżka w terenie).

## 3. Sprawdzenie
W JARVIS: **⚙ → AI → „🔄 Odśwież modele z Ollamy"** (zobaczysz realną listę) oraz **Stan systemu**
→ „Serwer inferencji aktywny: N model(i) … w pamięci: …" (health-check pinguje `/api/tags` i `/api/ps`).

## Pliki w tym katalogu
- `docker-compose.yml` — wariant Linux/NAS (kontener `ollama/ollama` + wolumen + CORS).
- `setup.ps1` — Windows: ustawia env + `ollama pull` wszystkich modeli jedną komendą + opcjonalnie `tailscale serve`.
