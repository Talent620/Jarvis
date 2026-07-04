# JARVIS — Roadmapa premium (po audycie)

Sekwencja „myśl → projektuj → implementuj → testuj → optymalizuj", każdy etap = zielone testy +
build + commit. Nic ryzykownego bez testu/zgody.

## ✅ Zrobione (ta runda)
1. **Rdzeń niezawodności** — backoff, dedup, circuit breaker, cache warstwowy, telemetria (errorLog).
2. **Streaming** odpowiedzi dla dostawców OpenAI-compat (+ Ollama on-device, + proxy BFF).

## ▶ Następny etap (uproszczenie/ujednolicenie — bez nowych funkcji)
Priorytet wg „efekt premium ÷ ryzyko":

1. **Jeden język komunikatów** — `toastOk/toastErr/toastInfo` (spójny ton, bez emoji-chaosu); migracja 64 wywołań. *(safe)*
2. **Wspólne stany ładowania** — jeden `<Spinner/>`/skeleton zamiast „Tworzę…" tekstem w 6+ ekranach. *(safe)*
3. **Streaming Anthropic + Gemini** — osobne akumulatory SSE (testowalne), ten sam wzorzec fallbacku. *(flagowe — ostrożnie)*
4. **Scalenia (zatwierdzone)**: 4 Studia → 1 „Studio" (wybór trybu); Pamięć+Profil → 1 „O mnie"; Lista zakupów+Łowca+Gdzie kupię → 1 „Zakupy". *(refaktor UI — krok po kroku, z weryfikacją)*
5. **Ikony + ARIA** — etykiety i `aria-label` na przyciskach-emoji (dostępność, czytniki ekranu).
6. **ESLint + Prettier** w aplikacji (dziś tylko `tsc`); reguły hooks/react.
7. **Redukcja inline-styli** — wydzielić powtarzalne wzorce do utility-klas (spójność wizualna).
8. **Mniej kliknięć** — usunąć zdublowane ścieżki dostępu (np. Koszty w 2 miejscach), command palette (osobny etap).

## ▶ Niezawodność „użytkownik nigdy nie widzi błędu" (priorytet D — dokończenie)
- Wpiąć `cached()` w odczyty (saldo OpenRouter, status API, pogoda) — mniej zapytań, szybciej.
- Wpiąć `dedupe()` w równoległe statusy/health-checki.
- Banner offline + kolejka żądań (wysyłka po powrocie sieci).
- Ekran „🛡 Niezawodność" w diagnostyce (z `reliabilityStats()` — już dostępne).

## ▶ Bezpieczeństwo (odłożone decyzją właściciela — do wznowienia na życzenie)
- `admin.ts`: sekret wysokiej entropii zamiast numeru telefonu (+ migracja).
- Keystore/podpis EXE/`release.yml`→tagi.
- BFF fail-closed domyślnie (`REQUIRE_APP_TOKEN`).

## ▶ „WOW, samo o tym pomyślało" (subtelna inteligencja, bez zaśmiecania)
Tylko gdy nie dokłada UI ani złożoności:
- Proaktywne podpowiedzi już są (Faza 7) — dostroić trafność.
- Po streamingu: lekki wskaźnik „myśli…/pisze…" zamiast statycznego orba (część dowieziona).
