# JARVIS — instalacja (wszystko w jednym miejscu)

Najnowsze pliki są zawsze pod stałym adresem (rolujący tag `latest`):
**https://github.com/Talent620/Jarvis/releases/tag/latest**

Masz 4 klocki. Telefon to aplikacja, a PC może być Twoim prywatnym „serwerem AI"
(tekst + obraz). Bierzesz tyle, ile chcesz.

---

## 1) 📱 Telefon (Android) — aplikacja
Plik: **`jarvis.apk`**
👉 https://github.com/Talent620/Jarvis/releases/download/latest/jarvis.apk

1. Pobierz na telefon, otwórz.
2. Jeśli Android zapyta — zezwól na „instalację z nieznanych źródeł".
3. Otwórz JARVIS. W **⚙ → Dane** sprawdź datę build (powinna być dzisiejsza).

## 1b) 🍏 iPhone (iOS)
Na iOS nie ma instalowalnego pliku z internetu (zasada Apple). Trzy realne drogi:

1. **Najprościej — PWA (zalecane, bez konta):** otwórz adres aplikacji w **Safari** →
   przycisk **Udostępnij** (kwadrat ze strzałką) → **„Do ekranu początkowego"**. JARVIS
   pojawi się jako ikona i działa jak aplikacja (pełny ekran, sam się odświeża do najnowszej).
2. **Pełna aplikacja natywna (sideload):** zbuduj na Macu (Xcode) i wgraj na telefon przez
   **AltStore/Sideloadly** z darmowym Apple ID (ważność 7 dni) — projekt iOS jest w repo (`ios/`).
3. **App Store:** wymaga konta **Apple Developer** (99 USD/rok) i podpisu — wtedy pełne,
   automatyczne aktualizacje.

> Głos i większość funkcji działają na iOS przez Safari/WKWebView. Mikrofon (rozpoznawanie
> mowy na żywo) bywa ograniczony w PWA — wtedy używaj pola tekstowego.

## 2) 💻 Komputer (Windows) — aplikacja na pulpit (opcjonalnie)
Plik: **`JARVIS.exe`**
👉 https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe

Dwuklik → Dalej → Zainstaluj. Jeśli pojawi się niebieski ekran „System Windows ochronił
Twój komputer" → **„Więcej informacji" → „Uruchom mimo to"** (normalne dla własnych narzędzi).

## 3) 🧠 Serwer Ollama na PC — prywatny mózg (tekst + wizja)
To zamienia Twój komputer w domowy serwer modeli, z którego telefon korzysta zdalnie.

Plik (jeden klik, robi wszystko): **`JARVIS-Ollama-Server.exe`**
👉 https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS-Ollama-Server.exe

1. Pobierz i **dwuklik**. (SmartScreen → „Więcej informacji" → „Uruchom mimo to").
   - ⚠️ **Nie uruchamiaj pliku `.ps1` dwuklikiem** — Windows otworzy go w Notatniku.
     Jeśli masz tylko `.ps1`, użyj **`JARVIS-Serwer.cmd`** (dwuklik) albo prawy klik → „Uruchom w PowerShell".
2. Okno samo: zainstaluje Ollamę (jeśli trzeba), pobierze modele premium, wyłączy usypianie PC,
   pokaże adres i **stronę z kodem QR**. **Zostaw to okno otwarte** (zamknięcie = stop serwera).
3. Na telefonie: ⚙ → **AI** → „Lokalny model — adres Ollama" → wklej adres z okna
   (`http://192.168.x.x:11434`) → dostawca „Lokalny model (Ollama)" → „Odśwież modele".
4. W „🧠 Refleks i Kora" kliknij **🚀 Tryb premium lokalny (auto)** (dobierze + pobierze + ustawi)
   albo **⚙ Dobierz z moich modeli**.

**Zdalnie poza domem:** zainstaluj **Tailscale** na PC i telefonie (jeden tailnet, darmowy),
potem użyj adresu `http://100.x.x.x:11434`. W APK działa http; w przeglądarce (PWA) użyj
`tailscale serve https / 11434`. Szczegóły: `server/ollama/README.md`.

## 4) 🖼 Serwer obrazów na PC — Studio lokalnie (Stable Diffusion)
Tworzenie/edycja obrazów na Twoim GPU, za darmo i offline. (Tego nie da się spakować w jeden
`.exe` — to duży program; instalujesz raz u siebie.)

1. Zainstaluj **Forge** (polecany) lub **Automatic1111** i pobierz model bazowy (np. SDXL):
   - Forge: https://github.com/lllyasviel/stable-diffusion-webui-forge
   - A1111: https://github.com/AUTOMATIC1111/stable-diffusion-webui
2. W `webui-user.bat` dodaj: `set COMMANDLINE_ARGS=--api --listen --cors-allow-origins=*`, uruchom.
3. W JARVIS: ⚙ → **AI** → „🖼 Lokalny generator obrazów" → wklej `http://192.168.x.x:7860`.
4. W **Studiu** wybierz **„Lokalny (Stable Diffusion)"** → opis (txt2img) lub zdjęcie do edycji (img2img).

Szczegóły (Tailscale, modele, VRAM): `server/sd/README.md`.

---

## Najszybsza ścieżka (minimum)
1. Telefon: zainstaluj **`jarvis.apk`**.
2. PC: uruchom **`JARVIS-Ollama-Server.exe`**, zostaw okno otwarte.
3. Telefon: wklej adres z okna w ⚙ → AI, kliknij **🚀 Tryb premium lokalny (auto)**.
Gotowe — masz prywatnego, lokalnego asystenta. Obrazy i dostęp spoza domu dodajesz później (pkt 3–4).

## Gdy „failed to fetch" / nie łączy
- Na telefonie **nie wpisuj `localhost`** — to sam telefon. Użyj adresu PC (`192.168...` lub `100...` Tailscale).
- W przeglądarce (https) http nie przejdzie → **użyj APK**.
- CORS → uruchom `JARVIS-Ollama-Server.exe` (ustawia to sam) lub dodaj `OLLAMA_ORIGINS=*`.
- Telefon i PC w tej samej sieci Wi-Fi (lub Tailscale).
