# Polityka prywatności — JARVIS

_Ostatnia aktualizacja: 2026-06-16_

JARVIS to osobisty asystent AI. Projektujemy go tak, by **dane zostawały na Twoim
urządzeniu**, a klucze API **nigdy** nie trafiały do aplikacji (patrz `SECURITY.md`).

## Gdzie są Twoje dane
- **Lokalnie na urządzeniu** (localStorage WebView): rozmowy, zadania, notatki, leady,
  ustawienia, ewentualne klucze w trybie „własny klucz" (opcjonalnie za blokadą PIN/sejfem).
- **Backup wyłączony** (`allowBackup=false`) + reguły wykluczające magazyn danych z kopii
  chmurowej i transferu między urządzeniami.
- **BFF (Cloudflare Worker)** — jeśli używasz wbudowanych modeli, treść zapytania przechodzi
  przez Twój BFF do dostawcy AI. BFF **nie loguje** treści ani kluczy.
- **Synchronizacja** (opcjonalna) — tylko gdy sam ją włączysz (adres + token).

## Uprawnienia i po co
| Uprawnienie | Cel |
|---|---|
| **RECORD_AUDIO** | Rozpoznawanie mowy i słowo-klucz „Jarvis". Nagranie przetwarzane do transkrypcji; nie jest trwale przechowywane bez Twojej akcji. |
| **FOREGROUND_SERVICE / _MICROPHONE** | Nasłuch słowa-klucza w tle (usługa pierwszoplanowa z widoczną notyfikacją). |
| **CAMERA** | Wizja („co widzisz?") i skan QR — tylko na Twoje żądanie. |
| **READ_CONTACTS** | Dzwonienie/SMS do kontaktu po imieniu — odczyt lokalny, bez wysyłania kontaktów. |
| **READ_CALENDAR / WRITE_CALENDAR** | Odczyt i dodawanie wydarzeń w kalendarzu urządzenia. |
| **POST_NOTIFICATIONS** | Przypomnienia i powiadomienia. |
| **SCHEDULE_EXACT_ALARM** | Punktualne przypomnienia/minutnik. |
| **INTERNET** | Połączenie z modelem AI (przez BFF) i usługami (pogoda, mapy, research). |

## Czego NIE robimy
- Nie sprzedajemy danych. Nie profilujemy reklamowo.
- Nie wysyłamy kontaktów, kalendarza ani nagrań na nasze serwery (nie prowadzimy własnych).
- Nie wpiekamy kluczy API do aplikacji.

## Usuwanie danych
Wyczyść dane aplikacji w ustawieniach systemu Android, albo użyj w aplikacji eksportu/kasowania
(⚙ → Dane). Odinstalowanie usuwa wszystkie dane lokalne.

## Dostawcy zewnętrzni
Zapytania AI trafiają do wybranego dostawcy (Anthropic, Google, Groq, OpenRouter, NVIDIA,
Mistral, Cerebras) — obowiązują ich polityki prywatności. Research: Tavily. Mapy/pogoda:
OpenStreetMap/Open-Meteo.

## Kontakt
Pytania o prywatność: skontaktuj się z autorem aplikacji.
