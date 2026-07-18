# JARVIS Site OS

Osobny, przeglądarkowy warsztat stron połączony z JARVISEM. Działa lokalnie bez instalowania dodatkowych paczek npm.

## Uruchomienie

W zainstalowanym JARVIS-ie: **Ustawienia → Integracje → JARVIS Site OS → Uruchom Site OS**. Kreator jest częścią instalatora Windows i nie wymaga osobnej instalacji Node.js.

Z repozytorium: kliknij dwukrotnie `start.cmd`.

Terminal:

```bash
cd site-os
npm start
```

Edytor otworzy się pod adresem [http://127.0.0.1:3210](http://127.0.0.1:3210).

## Co działa

- pełnoekranowy edytor desktop/tablet/telefon,
- trzy kompletne szablony startowe oraz czysty projekt,
- biblioteka responsywnych sekcji: hero, korzyści, dowody, opinie, cennik, FAQ, formularz i CTA,
- czytelna struktura strony i gotowe palety marki,
- wybieranie i edycja tekstu, linków, zdjęć, kolorów i odstępów,
- przesuwanie, duplikowanie i usuwanie elementów,
- audyt 0–100 obejmujący SEO, dostępność, telefon i konwersję oraz bezpieczne autopoprawki,
- formularze leadowe, skrzynka kontaktów i eksport CSV,
- edycja tytułu i opisu SEO oraz eksport gotowego HTML,
- automatyczny zapis projektów i historia 20 wersji,
- import istniejącego pliku HTML,
- kolejka poleceń dla JARVISA,
- lokalny podgląd strony bez panelu edytora,
- tymczasowy publiczny link przez Cloudflare Tunnel,
- token i sześciocyfrowy kod parowania.

## Tunel

Przycisk **Uruchom tunel** automatycznie pobiera oficjalny program Cloudflare do prywatnego katalogu `site-os/.tools/` i uruchamia go bez konfiguracji routera. Ręczna instalacja nie jest wymagana. Własną lokalizację programu można opcjonalnie podać przez `CLOUDFLARED_PATH`.

Tunel wystawia wyłącznie zapisany podgląd projektu. Endpointy projektów i edytor wymagają tokenu, a lokalna sesja edytora jest wydawana tylko dla połączenia z tego komputera.

## API dla JARVISA

- `GET /api/health` - stan i wersja Site OS,
- `POST /api/pair` - parowanie kodem,
- `POST /api/public/projects` - przekazanie projektu lub leada,
- `GET /api/public/commands` - kolejka poleceń AI,
- `PUT /api/public/commands/:id` - zapis wyniku JARVISA,
- `POST /api/leads/:projectId` - zapis kontaktu z publicznego formularza,
- `GET /api/leads/:projectId` - prywatna lista kontaktów w edytorze,
- `GET /p/:projectId` - podgląd strony dla klienta.

Autoryzacja: `Authorization: Bearer <token>` lub `X-Jarvis-Token`.
