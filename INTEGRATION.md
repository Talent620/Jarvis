# JARVIS ⇄ AI Sales OS — wdrożenie i połączenie

Dwa **osobne** narzędzia, jeden token. JARVIS (asystent) ma wgląd do AI Sales OS
(CRM w katalogu [`sales-os/`](sales-os/)) i może w nim tworzyć oraz auto-wysyłać
maile — ale to Sales OS jest źródłem prawdy (treść, scoring, lejek, dostawca poczty).

Ten dokument prowadzi od zera do „działa i wysyła naprawdę”.

---

## 1. Szybki start lokalny (1 polecenie)

Z katalogu JARVIS-a:

```bash
npm run salesos
```

Skrypt stawia bazę (Docker Postgres) → instaluje zależności → migruje schemat →
wypełnia dane demo → uruchamia serwer. Aplikacja: **http://localhost:3000**
(login demo: `owner@northstar.studio` / `demo1234`). Warstwa AI działa od ręki bez
kluczy (wbudowany silnik „mock”).

> Bez Dockera: ustaw `DATABASE_URL` w `sales-os/.env` na działającego Postgresa,
> potem `cd sales-os && npm install && npm run db:push && npm run db:seed && npm run dev`.

---

## 2. Pobranie tokenu (autoryzacja JARVIS ⇄ Sales OS)

W Sales OS: **⚙ Ustawienia → Pozyskiwanie → Inbound** — skopiuj `X-Ingest-Token`.
Ten sam token autoryzuje wszystkie trzy publiczne endpointy używane przez JARVIS:

| Endpoint | Do czego |
|---|---|
| `GET /api/public/sync` | JARVIS pobiera leady + metryki (read-only) |
| `POST /api/public/leads` | JARVIS wsyła znalezione firmy (inbound) |
| `POST /api/public/outreach` | JARVIS zleca napisanie i wysyłkę maila |
| `POST /api/public/lead-status` | JARVIS wypycha zmianę statusu do lejka (dwukierunkowo) |

---

## 3. Połączenie w JARVIS-ie

**⚙ → Integracje → AI Sales OS:**

1. **Adres** — `http://localhost:3000` (lokalnie) lub adres wdrożenia.
2. **Token** — wklejony `X-Ingest-Token`.
3. **🔌 Test połączenia** — pokaże skrót pipeline’u, jeśli wszystko gra.
4. (opcjonalnie) **Auto-synchronizacja** — co 15/30/60/240 min.

Od teraz działają przyciski w Pulpicie Sprzedaży i w Teczce Klienta, oraz komendy
głosowe/czat: `salesos_open`, `salesos_sync`, `salesos_stats`, `salesos_push`,
`salesos_email`, `salesos_flush_emails`.

---

## 4. Realna wysyłka maili (RESEND / Mailgun)

Domyślnie Sales OS wysyła w trybie **symulowanym** — zapisuje pełny ślad (oś czasu,
metryka `emails.sent`, status akceptacji `EXECUTED`), ale nie wypuszcza maila na świat.
Żeby wysyłać **naprawdę**, ustaw w `sales-os/.env` (lub w zmiennych środowiskowych
hostingu) jedno z:

```bash
# Wariant A — Resend (najprościej): https://resend.com
RESEND_API_KEY="re_xxx"
EMAIL_FROM="Twoja Firma <kontakt@twojadomena.pl>"   # domena zweryfikowana w Resend

# Wariant B — Mailgun
MAILGUN_API_KEY="key-xxx"
MAILGUN_DOMAIN="mg.twojadomena.pl"
EMAIL_FROM="Twoja Firma <kontakt@twojadomena.pl>"
```

Po restarcie ten sam przepływ (`salesos_email`, przycisk „✉ Wyślij przez Sales OS”,
„✉ Auto-wyślij maile”) wysyła prawdziwe wiadomości. Nic w kodzie nie trzeba zmieniać.

> **Auto-wysyłka kolejki.** `POST /api/public/outreach {flushPending:true}` (przycisk
> „Auto-wyślij maile” / `salesos_flush_emails`) opróżnia kolejkę szkiców do dziennego
> limitu firmy. Limit i tryb pełnej automatyki ustawisz w Sales OS → Ustawienia.

---

## 5. Wdrożenie produkcyjne (Vercel + Neon)

Sales OS to standardowy Next.js 14 — wdraża się jak każda apka Next:

1. **Baza:** załóż darmowego Postgresa (np. [Neon](https://neon.tech) lub
   [Supabase](https://supabase.com)) i skopiuj `DATABASE_URL`.
2. **Vercel:** zaimportuj katalog `sales-os/` jako projekt (Root Directory = `sales-os`).
3. **Zmienne środowiskowe** (Vercel → Settings → Environment Variables):
   ```
   DATABASE_URL=postgresql://…           # z Neon/Supabase
   NEXTAUTH_SECRET=…                      # openssl rand -base64 32
   NEXTAUTH_URL=https://twoj-sales-os.vercel.app
   RESEND_API_KEY=re_xxx                  # do realnej wysyłki
   EMAIL_FROM=Twoja Firma <kontakt@twojadomena.pl>
   AI_PROVIDER=mock                       # lub openai/anthropic + odpowiedni klucz
   ```
4. **Migracja:** po pierwszym deployu uruchom `npx prisma migrate deploy` (lub
   `prisma db push`) względem produkcyjnej bazy, a potem opcjonalnie `npm run db:seed`.
5. W JARVIS-ie wpisz adres `https://twoj-sales-os.vercel.app` i token z kroku 2.

Pełny opis zmiennych: [`sales-os/.env.example`](sales-os/.env.example).

---

## 6. Jak to wisi razem (architektura)

```
   JARVIS (asystent)                         AI Sales OS (CRM, źródło prawdy)
   ─────────────────                         ───────────────────────────────
   Pulpit / Teczka / głos                    Next.js 14 + Postgres + Prisma
        │  x-ingest-token                    leady · scoring · lejek · AI · poczta
        ├─ GET  /api/public/sync     ───────▶ czyta leady + metryki (read-only)
        ├─ POST /api/public/leads       ────▶ wsyła firmy → scoring → lejek
        ├─ POST /api/public/outreach    ────▶ AI pisze mail → kolejka → WYSYŁKA
        └─ POST /api/public/lead-status ────▶ zmiana statusu → etap lejka
```

JARVIS niczego nie zapisuje w bazie Sales OS bezpośrednio — wszystko idzie przez
publiczne, tokenowane endpointy. Usunięcie/wyłączenie jednego narzędzia nie psuje
drugiego.
