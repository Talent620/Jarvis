# JARVIS — Przewodnik użytkownika

Krótki, praktyczny przewodnik. Pełna konfiguracja techniczna: `README.md`, `ARCHITECTURE.md`,
serwer pamięci: `server/README.md`.

## 1. Pierwsze uruchomienie (onboarding)
Przy pierwszym starcie JARVIS prowadzi przez 3 kroki:
1. **Mózg AI** — wklej dowolny klucz API (najszybciej darmowy klucz Gemini z aistudio.google.com —
   minuta, bez karty). JARVIS sam rozpozna dostawcę i przetestuje połączenie.
2. **Głos i charakter** — Twoje imię + osobowość (Operacyjny / Klasyczny / Ciepły / Błyskotliwy).
3. **Tour** — co potrafi.

Model **BYOK** (Bring Your Own Key): klucze są Twoje, trzymane lokalnie na urządzeniu.

## 2. Klucze API (⚙ → AI)
- Wklej **dowolny** klucz — JARVIS rozpozna dostawcę po formacie (Anthropic, Gemini, Groq, OpenRouter,
  Cerebras, Mistral, NVIDIA, GitHub Models).
- Tryb **„auto"** wybiera najlepszego dostawcę z wpisanym kluczem i dobiera model do zadania
  (router: proste → szybki/tani, złożone → mocniejszy; obraz → model z wizją).
- Możesz wpisać kilka kluczy — przy limicie/awarii JARVIS **automatycznie przełącza** dostawcę (failover).

## 3. Rozmowa
- **Pisz lub mów.** Mikrofon = dyktowanie; słuchawka (☎) = rozmowa na żywo (Gemini Live: barge-in,
  napisy, opcjonalna kamera „📷 Pokaż kamerę"). Bez klucza Gemini działa uniwersalny „Tryb rozmowy".
- **Czat prywatny (🕶)** — rozmowa nie trafia do historii, znika po odświeżeniu (jak tryb incognito).
- **Historia** — lista, wyszukiwarka, grupowanie po dacie (🕘 w menu „Więcej").

## 4. Co JARVIS potrafi (skrót)
- Zadania, notatki, przypomnienia, kalendarz, lista zakupów, dziennik.
- Wysyłka maili/SMS, telefon, nawigacja, smart home, sterowanie komputerem (Windows) — **za zgodą**
  (akcje zewnętrzne/nieodwracalne pytają o potwierdzenie; możesz „zapamiętać" zgodę).
- Sprzedaż/leady (CRM), generowanie treści i reklam, Studio Obrazów, kreator stron.
- Wyszukiwanie w sieci, pogoda, kursy/rynki, tłumacz na żywo, transkrypcja spotkań.

## 5. Pamięć
- **Profil** (👤) i **Pamięć** (🧠) — co JARVIS o Tobie wie; możesz edytować/usuwać.
- **Pamięć długoterminowa (Mem0)** — opcjonalny własny serwer (`server/`), adres w ⚙ → Integracje.
  Bez niego JARVIS działa normalnie (pamięć z bieżącej rozmowy + profil).
- **Proaktywność** — w 🔔 Powiadomieniach sekcja „💡 Propozycje JARVIS-a" (najbliższe wydarzenie,
  poranny briefing, zaległe zadania, powracające tematy).

## 6. Koszty (💸 Koszty AI — menu „Więcej")
- Zużycie tokenów i koszt per wywołanie, sumy dziś / 7 dni / 30 dni, rozbicie per dostawca i model.
- **Prognoza miesięczna** (run-rate) i **budżet** z ostrzeżeniem (≥80%) / przekroczeniem (≥100%).
- Cennik możesz nadpisać (JSON) — przy nietypowych stawkach dostawcy.

## 7. Prywatność i bezpieczeństwo
- Wszystko zostaje **na Twoim urządzeniu**; kopia zapasowa w ⚙ → Dane.
- **Tryb on-device (⚙ → AI):** twarda blokada chmury — JARVIS używa wyłącznie modelu lokalnego
  (Ollama), web-search wyłączony, **nic nie opuszcza urządzenia**.
- **Tryb nieocenzurowany** działa realnie tylko z modelem lokalnym (chmura ma własne zasady dostawcy).
- Integracje (MCP) mają **allowlistę hostów** (ochrona przed nadużyciem narzędzi).

## 8. White-label
⚙ → Zachowanie → **„Nazwa asystenta (white-label)"** — własna marka w nagłówku, ekranie powitalnym
i rozmowie na żywo. Puste = „JARVIS". Nie zmienia działania modelu, tylko wygląd.

## 9. Instalacja
- **Android:** pobierz `jarvis.apk` (Releases → `latest`), zezwól na instalację z nieznanych źródeł.
- **Windows:** pobierz `JARVIS.exe` i zainstaluj (Dalej → Dalej → Zainstaluj).
- **Przeglądarka/PWA:** otwórz stronę i „Dodaj do ekranu głównego".
