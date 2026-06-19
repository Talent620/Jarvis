# JARVIS — co gdzie jest (szybka ściąga)

## Ekran główny (góra)
- **🩹 Uruchom i napraw** (złoty) — najważniejszy przycisk: sprawdza serwer, sam wybiera działający
  mózg, naprawia ustawienia, daje status „✅ gotowe". Kliknij, gdy coś nie odpowiada.
- **🎙 Tryb Słuchawki** — rozmowa hands-free.
- **☎ Rozmowa na żywo** — dwukierunkowy głos (Gemini Live).
- **🕶 Czat prywatny** — tymczasowy, nie trafia do historii.
- **🔔 Powiadomienia**, **＋ Nowy czat**, **⚙ Ustawienia**, **⋯ Więcej**.
- Pod logo: aktualny model · ONLINE/OFFLINE · **🛡 Lokalnie / ☁ Chmura** (wskaźnik trybu mózgu).

## ⋯ Więcej (menu)
- **🎨 Studio Obrazów — generuj/edytuj** (tu robisz grafiki), plus pozostałe gadżety/narzędzia.

## ⚙ Ustawienia → zakładka AI (najważniejsze)
Od góry:
1. **Dostawca + Model** — kogo używać. Zostaw „auto", chyba że chcesz konkretny.
2. **Klucze API** (chmura) — Gemini/Groq/Cerebras/… (po jednym w linii, można kilka).
3. **🔍 Znajdź serwer automatycznie** — łączy lokalną Ollamę (na PC od ręki).
4. **Lokalny model — adres Ollama** — `http://IP-PC:11434` (telefon: adres PC, nie localhost).
5. **🖼 Lokalny generator obrazów — adres Stable Diffusion** — `http://IP-PC:7860` (+ „🔌 Sprawdź").
6. **🧠 Refleks i Kora (zaawansowane)** — serce trybu lokalnego:
   - **🚀 Tryb premium lokalny (auto)** — dobiera + pobiera modele + włącza inteligencję.
   - **⚙ Dobierz z moich modeli** — konfiguruje się z tego, co już masz.
   - **➕ Dodaj model jednym tapnięciem** — katalog do pobrania.
   - **🏎 Zmierz szybkość modeli** — ile tok/s wyrobi każdy na Twoim PC + „⚡ jako szybki".
   - Przełączniki: lokalnie‑najpierw, Brama Pewności, Spekulacja, Konsylium, adaptacja, prewarm,
     🪜 Drabina Mądrości, 🎯 self‑consistency, model per typ zadania.
7. **🧭 Mózg na żywo** — podgląd decyzji (co poszło lokalnie, co do chmury).

## ⚙ Ustawienia → Zachowanie / Głos
- **Osobowość** — charakter (np. „Naturalny"), długość odpowiedzi, suwak ciepła rozmowy.
- **Głos** — JARVIS mówi po polsku najlepszym dostępnym polskim głosem (możesz wybrać inny).

## Gdy coś nie działa
1. Kliknij **🩹 Uruchom i napraw**.
2. Lokalny serwer: uruchom **`JARVIS-Ollama-Server.exe`** (działa w tle, możesz zamknąć okno).
3. „failed to fetch": na telefonie nie wpisuj `localhost` — podaj adres PC; w przeglądarce użyj APK.

Pełne instrukcje: `docs/INSTALACJA.md`. Tryb lokalny: `docs/REFLEKS_KORA.md`.
