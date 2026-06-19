# JARVIS — lokalny generator obrazów (Stable Diffusion) na Twoim PC

Studio JARVIS-a umie tworzyć/edytować obrazy **na Twoim komputerze** — za darmo, offline, bez
limitów — przez API zgodne z **Automatic1111 / Forge / SD.Next**. Z telefonu łączysz się jak z
Ollamą: po tej samej sieci Wi-Fi albo zdalnie przez **Tailscale**.

> Ollama służy do tekstu i **wizji** (rozumienia obrazu). **Generowanie** obrazów to dyfuzja
> (Stable Diffusion / FLUX) — osobny silnik, opisany tutaj.

## 1. Zainstaluj serwer (jednorazowo)
Najprościej **Stable Diffusion WebUI Forge** (szybki, wspiera SDXL i FLUX) albo klasyczny
**Automatic1111**:
- Forge: https://github.com/lllyasviel/stable-diffusion-webui-forge
- A1111: https://github.com/AUTOMATIC1111/stable-diffusion-webui

Pobierz model bazowy do katalogu `models/Stable-diffusion`, np.:
- **SDXL** (`sd_xl_base_1.0.safetensors`) — uniwersalny, dobra jakość.
- **FLUX.1 [dev/schnell]** — topowa jakość 2026 (większe wymagania VRAM).

## 2. Włącz API + dostęp z sieci (krytyczne)
W pliku **`webui-user.bat`** (Windows) ustaw flagi:
```bat
set COMMANDLINE_ARGS=--api --listen --cors-allow-origins=*
```
- `--api` → włącza `POST /sdapi/v1/txt2img` i `/img2img` (z tego korzysta JARVIS),
- `--listen` → serwer słucha w sieci LAN (nie tylko 127.0.0.1) — telefon może dobić,
- `--cors-allow-origins=*` → bez tego przeglądarka/WebView blokuje żądania (CORS).

Uruchom `webui-user.bat`. Domyślny adres: **`http://IP-PC:7860`**.
W zaporze przepuść port **7860** (sieć prywatna).

## 3. Zdalnie z telefonu „w terenie" (Tailscale)
- Zainstaluj **Tailscale** na PC i telefonie (jeden tailnet). Wtedy z dowolnej sieci użyj
  `http://100.x.x.x:7860` (adres PC w tailnecie). Bez otwierania portów na świat.
- **Mixed-content:** PWA po `https://` nie połączy się z `http://…` → użyj **APK** (dopuszcza
  cleartext do LAN/tailnetu) albo wystaw HTTPS (`tailscale serve https / 7860`).
- ⚠️ Nigdy nie wystawiaj WebUI publicznie bez bramki (Tailscale/Cloudflare Access) — `--api`
  bez ochrony = każdy może generować na Twoim GPU.

## 4. Podłącz w JARVIS
1. ⚙ → **AI** → „🖼 Lokalny generator obrazów — adres Stable Diffusion" → wklej `http://IP-PC:7860`.
2. W **Studiu** wybierz model **„Lokalny (Stable Diffusion)"**.
3. Wpisz opis (txt2img) albo dołącz zdjęcie do edycji (img2img) i generuj — wszystko na Twoim PC.

## Wymagania sprzętowe (uczciwie)
- 4 GB VRAM: SD 1.5 da radę; SDXL na granicy (użyj wariantów `--medvram`/`--lowvram`).
- 8–12 GB VRAM: komfortowy SDXL; FLUX schnell.
- 16 GB+: FLUX dev w pełnej jakości.
