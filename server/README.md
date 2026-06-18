# JARVIS — serwer pamięci długoterminowej (Faza 1)

Self-hostowany **Mem0 + Qdrant**. JARVIS pamięta fakty o Tobie i ustalenia między sesjami,
a do kontekstu wstrzykuje **tylko trafne** wspomnienia (semantyczne wyszukiwanie).

## Uruchomienie
```bash
cd server
cp .env.example .env      # uzupełnij OPENAI_API_KEY + MEM0_API_TOKEN (losowy)
docker compose up -d
```
Serwer pamięci: `http://localhost:8000` (Qdrant tylko wewnętrznie).

## Podłączenie do JARVIS
W aplikacji: **⚙ Ustawienia → Integracje → Pamięć** (lub `memoryServiceUrl`/`memoryServiceToken`):
- adres: `http://<twój-host>:8000`
- token: ten sam co `MEM0_API_TOKEN`.

Gdy adres pusty lub serwer niedostępny — JARVIS **działa dalej bez pamięci długoterminowej**
(graceful degradation), korzystając z lokalnej pamięci faktów.

## Namespace'y (izolacja)
- `personal` — fakty o użytkowniku.
- `business` — klienci/projekty (aktywny projekt w JARVIS).
Klient nigdy ich nie miesza — `user_id` rozdziela dane po stronie Mem0.

## Debug / podgląd / czyszczenie (chronione tokenem)
- Podgląd: `GET /memories?user_id=personal` (nagłówek `Authorization: Bearer <token>`).
- Usunięcie wpisu: `DELETE /memories/<id>`.

## Bezpieczeństwo
- Sekrety wyłącznie w `server/.env` (gitignored) — nigdy w repo.
- Wystaw `8000` tylko w zaufanej sieci / za reverse-proxy z TLS; token wymagany.
