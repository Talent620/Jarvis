# JARVIS — Email System Audit + Gap Analysis (PHASE 0/1)

> Read-only audyt systemu e-mail (outbound/CRM). Brutalnie szczerze, ze scoringiem 0–100 i jawnym
> rozdziałem: co wykonalne client-side vs co WYMAGA backendu. Stan 2026-06-25.

## 1. Architektura wysyłki — `src/lib/mailer.ts`
- Kanały: **SMTP-desktop** (`jarvisDesktop.sendMail`), **SMTP-relay** (backend `syncUrl` + dane SMTP), **Gmail-backend**, **Gmail-native** (compose URL), **mailto**.
- `mailReadiness()` / `canSendDirect()` — wykrywa najlepszy dostępny kanał. `sendMailNow()`, `recordSent()`, `verifyMailConnection()`, `isValidEmail`.
- Encja **`SentMail`** (to/subject/company/via/at) w `store.data.sentMail`. Eksport CSV.

## 2. Podpisy — `glinks.ts` + `store.settings.emailSignature`
- **JEDEN** podpis (`emailSignature`), doklejany przez `appendSignature` w `splitOffer`. Brak wielu podpisów, brak wyboru przed wysyłką, brak zmiennych dynamicznych.

## 3. Personalizacja / treść
- Per-lead: `intel.email` (spersonalizowany mail z wywiadu), `lead.offer`, `splitOffer` (temat+treść). **Dynamiczny follow-up AI** (`followUpAI`) + **agent dostarczalności** (`emailDeliverability` — scoring spamu pod draftem). Brak edytora rich-text, brak akcji AI (skróć/rozwiń/ton).

## 4. CRM / sekwencje / harmonogram — `salesEngine.ts` / `salesOs.ts`
- Follow-upy: `nextFollowUpAt`, `scheduleFollowUp`, `followUpsDue`, `markContacted`. CRM przez Sales OS (outreach + sync). Prognoza pipeline.
- **Brak autonomicznej KOLEJKI wysyłki** — faktyczna wysyłka jest ręczna (harmonogram planuje, ale nie wysyła sam bez otwartej apki/backendu).

## 5. UI
- `LeadDetail` (draft + wyślij SMTP/Gmail/mailto/SalesOs/SMS + badge dostarczalności), `SalesPlan` (follow-upy + AI follow-up), `SentBox` (historia wysłanych + CSV), `AdStudio`.

## 6. Oceny (0–100) i porównanie (Gmail/Superhuman/Instantly/Smartlead/Apollo/HubSpot)

| Obszar | JARVIS | Uwagi |
|---|---:|---|
| Kanały wysyłki | 70 | wielokanałowo; brak jednej kolejki |
| Kontrola użytkownika / manual override | 65 | wysyłka ręczna wszędzie; brak jawnego ekranu „zatwierdź przed wysłaniem" |
| Podpisy | 30 | tylko jeden, brak wyboru/zmiennych |
| Kompozytor (edytor + akcje AI) | 35 | plain-text; brak skróć/rozwiń/ton (follow-up AI jest osobno) |
| Review przed wysyłką | 28 | tylko badge dostarczalności w LeadDetail |
| Narzędzia dostarczalności | 45 | scoring spamu ✓; SPF/DKIM/DMARC ✗ |
| Analityka (open/click/reply/bounce) | 20 | tylko log wysłanych |
| Harmonogram / kolejka | 40 | planowanie follow-upów ✓; auto-send ✗ |
| Personalizacja | 62 | intel/offer + dynamiczny follow-up |
| Command Center | 35 | SentBox pokazuje wysłane; brak wspólnej tablicy drafts/queued/scheduled |

## 7. Wykonalność (uczciwie — to klient Capacitor + BYOK)
- **Wykonalne client-side (bez backendu):** wiele podpisów + wybór przed wysyłką (PHASE 3), akcje AI kompozytora (PHASE 4), ekran review + score przed wysyłką (PHASE 5), tryby manual/approve/bulk (PHASE 6 częściowo), Command Center z lokalnych danych (drafts/sent).
- **WYMAGA backendu/serwera (poza zakresem czystego klienta):** tracking open/click/reply/bounce (piksele/webhooki), SPF/DKIM/DMARC (DNS), autonomiczna kolejka wysyłająca o czasie bez otwartej apki, reputacja domeny.

## 8. Roadmapa wg ROI / ryzyka (PHASE 10)
| # | Funkcja | ROI | Złożoność | Ryzyko |
|---|---|---|---|---|
| 1 | **Akcje AI kompozytora** (skróć/rozwiń/CTA/ton/przepisz) | wysoki | niska | niskie |
| 2 | **Wiele podpisów + wybór** (PHASE 3) | średni-wysoki | niska | niskie |
| 3 | **Ekran Review + score przed wysyłką** (PHASE 5) | wysoki | średnia | średnie (dotyka send flow) |
| 4 | Command Center (drafts/queued/sent/scheduled) | średni | średnia | średnie |
| 5 | Tracking / SPF-DKIM | wysoki | — | wymaga backendu |

**Pierwsza iteracja:** #1 — akcje AI kompozytora (najwyższy ROI, najniższe ryzyko, izolowane).
