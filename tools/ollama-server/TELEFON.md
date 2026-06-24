# 📲 JARVIS — Ollama na telefonie (krok po kroku)

Cel: telefon używa mózgu AI z Twojego PC (za darmo, prywatnie), a **link się nie rozłącza**.

## 1. PC — jeden klik
Pobierz i uruchom **`JARVIS-Ollama-Server.exe`** (dwuklik):
- https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS-Ollama-Server.exe

Plik sam: zainstaluje Ollamę (jeśli trzeba), ustawi nasłuch w sieci + CORS, otworzy port w zaporze,
**wyłączy usypianie PC**, pobierze modele, **włączy pilnowanie 24/7 (auto‑restart + auto‑start po
restarcie PC)** i pokaże **adres + kod QR**. Adres trafia też do schowka.

> Nie chcesz `.exe`? Użyj `JARVIS-Serwer.cmd` (dwuklik) albo prawy‑klik na `jarvis-ollama-server.ps1`
> → „Uruchom w PowerShell".

## 2. Telefon — dodanie adresu (30 sekund)
W aplikacji **JARVIS (APK)**:
1. **⚙ Ustawienia → AI**.
2. Dostawca: **„Lokalny model (Ollama)"**.
3. W polu **adres Ollama** wklej adres z PC (albo zeskanuj **kod QR**, który się otworzył):
   - ta sama Wi‑Fi: `http://192.168.x.x:11434`
   - z dowolnej sieci (Tailscale): `http://100.x.x.x:11434`
4. Kliknij **„🔄 Odśwież modele z Ollamy"** — zobaczysz listę modeli = działa. ✅
5. Model per zadanie ustawisz w **„🧠 Refleks i Kora"**.

Kolejne modele dociągasz **z telefonu**: wpisz nazwę (np. `phi4-mini`) i **⬇ Pobierz** — ściąga się na PC.

## 3. „Żeby link się nie rozłączał" — co już zrobione i co zalecam
- ✅ **Auto‑restart + auto‑start**: launcher rejestruje zadanie *„JARVIS Ollama Watchdog"* — serwer
  wstaje sam po restarcie PC i po awarii Ollamy. Nic nie musisz klikać.
- ✅ **PC nie usypia** na zasilaniu sieciowym (serwer dostępny 24/7).
- ⭐ **Stały adres (mocno zalecane):** zainstaluj **Tailscale** na PC i telefonie (jeden tailnet,
  darmowy). Adres `100.x` **nigdy się nie zmienia** — w przeciwieństwie do Wi‑Fi, gdzie po restarcie
  routera IP PC może się zmienić i trzeba by je wpisać ponownie. Tailscale = link trwały, też poza domem.

## Coś nie działa?
- **„Failed to fetch" / pusto po odświeżeniu** → najczęściej CORS lub zła sieć. Upewnij się, że to
  **APK** (nie przeglądarka), telefon i PC w tej samej sieci (lub w tym samym tailnecie).
- **403** → CORS: uruchom launcher ponownie (ustawia `OLLAMA_ORIGINS=*`).
- **Adres przestał działać** → IP Wi‑Fi się zmieniło. Odpal launcher (pokaże nowy adres) **albo** przejdź
  na Tailscale (adres stały).
- Diagnoza w apce: **Stan systemu** → „Serwer inferencji aktywny: N modeli…".
</content>
