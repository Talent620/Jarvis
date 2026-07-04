# JARVIS — Master System Audit (Revenue OS)

> Audyt warstwy przychodowej JARVIS-a (CRM / lead-gen / e-mail / web). Stan na 2026-06-25.
> Uczciwy, oparty na realnym kodzie repozytorium — nie na życzeniach. Skala ocen 0–100.

## 1. Mapa architektury (warstwa przychodowa)

```
Lead discovery   → src/lib/leads.ts (OSM/Overpass + web), leadImport.ts (CSV/wklejka), prospect.ts
Lead intel       → src/lib/leadIntel.ts (audyt strony → słabe punkty → e-mail/call/SMS), offer.ts
Scoring          → leadIntel.scoreLead / leads.scoreRawLead / scoreLabel (heurystyki)
Sales engine     → src/lib/salesEngine.ts (call-now wg godzin, follow-upy, forecast, tracking maili)
CRM sync         → src/lib/salesOs.ts / salesOs (mapowanie stage/outcome ↔ LeadStatus, snapshot)
E-mail           → src/lib/mailer.ts (SMTP-desktop / SMTP-relay / Gmail-backend), glinks.splitOffer
                   src/lib/emailDeliverability.ts (NOWE — scoring dostarczalności)
Content/Ads      → src/lib/content.ts, contentStudio.ts, adStudio.ts
Web builder      → src/lib/webgen.ts (generacja stron + audyt + self-improve + design engine)
UI               → SalesDashboard, SalesPlan, LeadDetail, SentBox, MoneyHub, ContentStudio, AdStudio, WebStudio
```

## 2. Mapa funkcji (co JEST)

- **Pozyskiwanie leadów:** mapy (OSM) + wyszukiwarka web, import CSV, scoring i ranking, dedup, ekstrakcja e-maili ze stron.
- **Wywiad o leadzie:** audyt strony (parseSiteHtml), słabe punkty, auto-draft e-maila + skryptu rozmowy + SMS.
- **Sales engine:** „dzwoń teraz" wg godzin otwarcia, automatyczne follow-upy z terminami, prognoza pipeline, oznaczanie kontaktu, wykrywanie wysłanych maili.
- **Wysyłka wielokanałowa (częściowo):** e-mail (SMTP/Gmail/relay), SMS (smsUrl), mailto/Gmail compose, AI Sales OS outreach.
- **CRM:** synchronizacja z backendem Sales OS, statusy, snapshot/metryki.
- **Web:** pełny generator stron (11 systemów projektowych, auto-strategia, audyt, self-improve, sekcje premium).
- **Treści:** generator postów, reklam, ofert.

## 3. Oceny modułów (0–100)

| Moduł | Revenue | Automatyzacja | Konwersja | Skalowalność | Wartość | Przewaga | Średnia |
|---|---|---|---|---|---|---|---|
| Lead discovery | 70 | 65 | 55 | 60 | 75 | 60 | **64** |
| Lead intel / drafty | 75 | 70 | 70 | 65 | 80 | 72 | **72** |
| Sales engine / follow-up | 70 | 68 | 65 | 70 | 72 | 60 | **68** |
| CRM (Sales OS) | 65 | 70 | 55 | 70 | 65 | 55 | **63** |
| E-mail / dostarczalność | 60 | 55 | 60 | 60 | 70 | 65 | **62** ↑ (po dodaniu scoringu) |
| Web builder | 85 | 80 | 75 | 70 | 88 | 80 | **80** |
| Treści / reklamy | 70 | 70 | 65 | 70 | 72 | 62 | **68** |

## 4. Luki vs konkurencja (Apollo / Clay / Instantly / Smartlead / HubSpot)

| Brak | Konkurent | Wykonalność w tej architekturze |
|---|---|---|
| SPF/DKIM/DMARC + reputacja domeny | Instantly/Smartlead | ⚠ wymaga zapytań DNS / backendu (klient WebView nie zrobi) |
| Scoring spamu treści maila | wszyscy | ✅ **ZROBIONE** (`emailDeliverability.ts`) |
| Intent „Why Now" (hiring/funding/tech) | Apollo/Clay | ⚠ wymaga zewnętrznych źródeł danych (płatne API) |
| Pain mining (Reddit/fora) | Clay | ⚠ wymaga scrapingu/API + backendu |
| Dynamiczny, rozumowany follow-up (nie szablon) | Smartlead | ✅ wykonalne (LLM + kontekst CRM/strony) — następny krok |
| Unified multichannel (LinkedIn/voice/SMS/kalendarz) | Apollo | 🟡 częściowo (e-mail+SMS jest; reszta = integracje) |
| Funnel engine (web→magnet→email→CRM) | HubSpot/Lovable | 🟡 elementy są osobno; brak spięcia w 1 przepływ |
| Conversion AI (ocena nagłówka/CTA/oferty) | Unbounce | ✅ wykonalne (rozszerzenie audytu webgen) |
| A/B testy wariantów | wszyscy | ⚠ wymaga ruchu/analityki/backendu |

## 5. Co dostarczono w tej iteracji

- **Agent dostarczalności e-maili** (`emailDeliverability.ts`): deterministyczny scoring 0–100 + konkretne poprawki (słowa-spam, CAPS, wykrzykniki, długość tematu/treści, liczba linków, brak CTA, brak personalizacji). **5 testów.** Wpięty w `LeadDetail` pod draftem maila — widzisz ryzyko spamu i co poprawić, ZANIM wyślesz.

## 6. Rekomendacje — ranking wg ROI

| # | Rekomendacja | ROI | Złożoność | Ryzyko | Wpływ |
|---|---|---|---|---|---|
| 1 | **Dynamiczny follow-up (LLM + kontekst)** zamiast szablonów | wysoki | średnia | niskie | konwersja outbound ↑ |
| 2 | **Conversion AI** dla generowanych stron (nagłówek/CTA/oferta/trust → score) | wysoki | niska | niskie | jakość web ↑ |
| 3 | **Funnel engine** — z opisu produktu: landing + lead magnet + sekwencja + pipeline | wysoki | wysoka | średnie | nowa wartość |
| 4 | **Why-Now score** z sygnałów dostępnych ze strony/treści (bez płatnych API) | średni | średnia | średnie | priorytetyzacja leadów |
| 5 | SPF/DKIM/DMARC przez backend (gdy jest syncUrl) | średni | wysoka | średnie | dostarczalność ↑ |

## 7. Uczciwa konkluzja

JARVIS ma **realny, działający kręgosłup Revenue OS** (lead-gen → intel → drafty → follow-up → CRM → web), czego nie ma żaden „tylko-builder". Do poziomu Apollo/Clay brakuje **danych intent z zewnątrz** (płatne źródła) i **infrastruktury dostarczalności** (DNS/warm-up) — to wymaga backendu/integracji, nie samego klienta. Najszybsze realne skoki: **dynamiczny follow-up (LLM)** i **Conversion AI** — wykonalne tu i teraz, bez zewnętrznych zależności.

> Metodyka: oceny i mapy z bezpośredniej analizy plików `src/lib/*` i `src/components/*`. Pozycje „wykonalność" oznaczają realne ograniczenia architektury (Capacitor WebView + BYOK, bez własnego backendu poza opcjonalnym Sales OS / sync).
