# AI Sales & Client Acquisition OS

Kompletna, działająca aplikacja SaaS do pozyskiwania klientów dla małych firm usługowych — przechwytywanie leadów, scoring, segmentacja, lejek CRM, generowanie wiadomości przez AI, menedżer zadań, kolejka akceptacji działań AI, analityka oraz Copilot AI.

To **nie jest makieta** — to pełny, uruchamialny program: realny model danych (20 encji), wszystkie endpointy API, autentykacja, scoring, joby w tle i warstwa AI z wymiennym dostawcą. **Warstwa AI działa od razu po instalacji, bez żadnego klucza API** (wbudowany, deterministyczny silnik „mock").

---

## Stack technologiczny

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** (styl „new-york", paleta „Old Money / Sahara")
- **PostgreSQL** + **Prisma** (ORM, migracje, seed)
- **NextAuth** (Credentials + sesja JWT, hasła hashowane przez bcrypt)
- **Zustand** (stan UI), **Recharts** (wykresy)
- **React Hook Form** + **Zod** (formularze i walidacja)
- **Warstwa AI z adapterem** — `openai` / `anthropic` + fallback `mock`
- **Docker** + `docker-compose` (PostgreSQL), `Dockerfile` dla aplikacji

---

## Szybki start (lokalnie)

Wymagania: **Node 18+** (zalecane 20) oraz **Docker** (najprościej dla bazy).

```bash
# 1. Zależności
npm install

# 2. Baza danych (PostgreSQL przez Docker)
docker compose up -d db

# 3. Zmienne środowiskowe
cp .env.example .env
#    Wygeneruj sekret dla NextAuth i wklej do NEXTAUTH_SECRET:
#    openssl rand -base64 32

# 4. Migracje + dane demo
npm run db:migrate      # tworzy schemat
npm run db:seed         # wypełnia bazę realistycznymi danymi

# 5. Start
npm run dev
```

Aplikacja: **http://localhost:3000**

### Dane logowania (demo)

```
e-mail:  owner@northstar.studio
hasło:   demo1234
```

Drugie konto (członek zespołu): `weronika@northstar.studio` / `demo1234`.

> Możesz też założyć własne konto przez **/register** — utworzy nową, pustą firmę z domyślnym lejkiem.

---

## Aplikacja na Windows i telefon (PWA)

Narzędzie jest **instalowalną aplikacją (PWA)** — jeden kod działa jako aplikacja okienkowa na Windows/macOS i jako aplikacja na telefonie:

- **Windows / macOS:** otwórz aplikację w **Edge lub Chrome** → ikona „Zainstaluj aplikację" w pasku adresu (lub menu ⋯ → *Aplikacje → Zainstaluj*). Dostajesz osobne okno bez przeglądarki, ikonę w Menu Start / Docku i skróty (kolejka telefoniczna, Lead Finder, Approvals) pod prawym przyciskiem na ikonie.
- **Android:** Chrome → menu ⋮ → **„Dodaj do ekranu głównego" / „Zainstaluj aplikację"**.
- **iPhone/iPad:** Safari → Udostępnij → **„Dodaj do ekranu początkowego"**.

Na telefonie interfejs ma **dolny pasek nawigacji** (Home / Leads / Calls / Finder / Menu) jak w aplikacji natywnej, a kolejka telefoniczna dzwoni jednym tapnięciem (`tel:`). Service worker cache'uje statyki i pokazuje stronę offline przy braku sieci (dane CRM zawsze na żywo).

**Szybka nawigacja:** `Ctrl+K` / `⌘K` z dowolnego miejsca — globalna wyszukiwarka leadów (nazwa, firma, telefon, e-mail) i skok do każdej strony bez myszki.

> PWA wymaga HTTPS w produkcji (Vercel daje to od razu); lokalnie działa na `http://localhost`.

---

## Tryby AI

Aplikacja domyślnie używa wbudowanego silnika **mock** — wszystko (generator, Copilot, scoring) działa bez klucza i bez internetu. Aby włączyć prawdziwy model, ustaw w `.env`:

```bash
AI_PROVIDER="openai"            # lub "anthropic"
AI_API_KEY="sk-..."
AI_MODEL="gpt-4o-mini"          # np. claude-3-5-sonnet-latest dla anthropic
```

Adapter jest wymienny (`src/lib/ai/adapter.ts`). Jeśli klucza brak lub wywołanie się nie powiedzie — system **automatycznie wraca do trybu mock** i oznacza to w odpowiedzi (badge „mock"). Każde działanie AI jest zapisywane w dzienniku `AiDecisionLog`.

---

## Co przetestować (kluczowe przepływy)

1. **Dashboard** — KPI, lejek, źródła leadów, gorące leady, dzisiejsze/zaległe zadania, kolejka akceptacji.
2. **Leads** — filtry, sortowanie, dodawanie leada; wejście w szczegóły pokazuje **„dlaczego taki scoring"** (rozbicie punktów) oraz **next-best-action**.
3. **Pipeline** — tablica kanban; przesuwanie leada między etapami (Select „Move to…") aktualizuje bazę.
4. **AI Generator** — wybierz typ treści, leada i ofertę, wygeneruj draft. Domyślnie trafia do **kolejki akceptacji** (nic nie wysyła się automatycznie).
5. **Approvals** — zaakceptuj/odrzuć draft AI; akceptacja tworzy m.in. zadanie follow-up i wpis aktywności.
6. **Tasks** — filtrowanie po statusie, odhaczanie, dodawanie zadań.
7. **Campaigns** — utwórz kampanię, wejdź w jej szczegóły: **wygeneruj wiadomość przez AI** (z celem/kanałem/ofertą kampanii) lub dodaj ręcznie, **„Send"** rejestruje wysyłkę do dopasowanych leadów (wpis aktywności na leadzie + liczniki), a przyciski **Record reply / conversion** aktualizują reply-rate i konwersję. **Templates** — biblioteka szablonów z kopiowaniem.
8. **Analytics** — trendy (pipeline, reply rate, przychód), rozkład jakości leadów, dziennik AI.
9. **AI Copilot** — czat „uziemiony" w realnych danych firmy; zapytaj „What should I focus on today?". Pod odpowiedzią pojawiają się **wykonywalne akcje** (np. „Stwórz zadanie follow-up dla…", „Przejdź do akceptacji") działające na prawdziwych danych.
10. **Settings** — edycja profilu firmy i kontekstu AI, integracje, sekcja RODO.
11. **Lead Sources (samo-pozyskiwanie)** — zob. sekcję niżej: inbound (formularz + webhooki) i outbound (discovery z ICP). Kliknij **Run discovery**, żeby od razu dociągnąć przykładowych prospektów.

---

## Samodzielne pozyskiwanie leadów (inbound + outbound)

Strona **Autopilot** (`/acquisition`) spina dwie drogi automatycznego pozyskiwania. Każdy pozyskany lead przechodzi przez wspólny pipeline: **dedup → scoring → przypisanie właściciela → wpis aktywności → opcjonalny draft pierwszej odpowiedzi do kolejki akceptacji** (nic nie wysyła się samo).

**Inbound — leady same wpadają**
- Publiczny endpoint `POST /api/public/leads` (bez logowania) z honeypotem i rate-limitem. Token w nagłówku `X-Ingest-Token` lub w polu `token`.
- Webhooki: `POST /api/webhooks/{provider}?token=…` z mapowaniem Meta Lead Ads, Google Lead Forms, Typeform, Tally, Calendly, Zapier/Make (oraz tryb generyczny dla dowolnego formularza).
- W demo token to **`demo-ingest-token`**. Szybki test (z odpalonym `npm run dev`):
  ```bash
  curl -X POST http://localhost:3000/api/public/leads \
    -H "Content-Type: application/json" \
    -H "X-Ingest-Token: demo-ingest-token" \
    -d '{"name":"Jan Kowalski","email":"jan@firma.pl","message":"Proszę o kontakt"}'
  ```
  Lead pojawi się w `/leads` i w „Recently captured", a (gdy auto-draft włączony) pierwsza odpowiedź AI trafi do `/approvals`.

**Outbound — apka sama szuka prospektów**
- Discovery dla wybranego ICP (Audience): `POST /api/acquisition/discover`. Bez kluczy działa wbudowany **mock** (przykładowe dane). Dla realnego źródła ustaw `APOLLO_API_KEY` lub `HUNTER_API_KEY` w `.env`.
- Dostępne też jako job `discover-leads` (cron/queue w produkcji).

---

## Autopilot pozyskiwania (autonomiczny)

Nad warstwą inbound/outbound działa **Acquisition Autopilot** — silnik, który sam, cyklicznie, **szuka prospektów ze wszystkich aktywnych ICP → wzbogaca je → zapisuje do sekwencji → pisze treść każdego kontaktu i wrzuca ją do kolejki akceptacji**. Sterowanie z poziomu UI: zakładka **Autopilot** na `/acquisition`.

**Zasada nadrzędna — human-in-the-loop.** Autopilot nigdy nie wysyła wiadomości samodzielnie. Każdy pierwszy kontakt i każdy krok sekwencji ląduje jako draft w `/approvals` — Ty akceptujesz i wysyłasz. To świadoma decyzja projektowa (bezpieczeństwo marki, zgodność, kontrola).

**Co robi w jednym „ticku" (`runAcquisitionTick`):**
1. sprawdza bramki: czy włączony, kadencja (jak dawno był ostatni run), godziny ciszy;
2. liczy budżet na dziś (dzienny limit vs. już pozyskane, cel/dzień, partia na ICP);
3. rozdziela pozyskiwanie po aktywnych ICP (`discoverForAllAudiences`);
4. wzbogaca nowe leady (domena z e-maila, szacowana wartość, priorytet, rescoring);
5. zapisuje nowe leady do **domyślnej sekwencji** (jeśli auto-enroll) i dociąga zaległe zapisy;
6. przesuwa wymagalne kroki sekwencji → drafty do akceptacji;
7. wykrywa „gorące" leady i alerty wydajności;
8. zapisuje audyt do `AcquisitionRun` (widoczny w „Activity") i metrykę dnia.

**Sekwencje (cadences).** Domyślna to sprawdzony 4-touch: D0 e-mail → D+2 dobicie → D+3 LinkedIn DM → D+4 break-up. W zakładce **Sequences** włączasz/pauzujesz, ustawiasz domyślną, zapisujesz „eligible" leady lub tworzysz nową kadencję. Każdy krok generuje treść przez warstwę AI (mock lub realny model).

**Sterowanie (UI):** master włącznik, kadencja, dzienny limit, cel/dzień, partia na ICP, godziny ciszy, kanały, auto-draft (inbound/outbound), auto-enroll, enrichment. „Run now" odpala tick natychmiast (z pominięciem kadencji/ciszy).

**Jak to chodzi cyklicznie:**
- **Lokalnie / self-host:** wbudowany scheduler in-process (`src/lib/scheduler.ts`, odpalany przez `src/instrumentation.ts`) tyka sam po `npm run dev`. Sterowanie: `ACQUISITION_AUTOPILOT_INPROCESS` (`0` = wyłącz), `ACQUISITION_TICK_SECONDS` (domyślnie 300).
- **Produkcja (zalecane):** zewnętrzny scheduler uderza w `POST /api/cron` (albo `GET`). Zabezpieczenie sekretem `CRON_SECRET` (`Authorization: Bearer <CRON_SECRET>`). Dla Vercela dołączony `vercel.json` z wpisem cron co 15 min (ustaw `CRON_SECRET` w env i `ACQUISITION_AUTOPILOT_INPROCESS=0`).

**Realne źródła prospektów:** ustaw `APOLLO_API_KEY` lub `HUNTER_API_KEY` (bez nich działa deterministyczny mock). **Realne AI:** `AI_PROVIDER` + `AI_API_KEY` + `AI_MODEL`.

**Endpointy:** `GET/PATCH /api/acquisition/settings`, `POST /api/acquisition/run`, `GET /api/acquisition/runs`, `GET/POST /api/sequences`, `PATCH/DELETE /api/sequences/[id]`, `POST /api/sequences/[id]/enroll`, `POST /api/jobs/[name]`, `GET/POST /api/cron`.

> **Uwaga:** schemat bazy się zmienił (nowe modele: `AcquisitionSettings`, `AcquisitionRun`, `Sequence`, `SequenceStep`, `SequenceEnrollment`). Po pobraniu wykonaj `npm run db:push` (lub `npm run db:migrate`) i `npm run db:seed`, żeby zobaczyć wypełnione demo autopilota.

---

## Lead Finder — firmy bez stron WWW (Google Maps + CEIDG)

Strona **Lead Finder** (`/prospecting`) znajduje lokalne firmy, które **nie mają strony internetowej** (lub mają słabą) — z numerami telefonów, adresami i ocenami Google. ~36% małych firm nie ma strony WWW; to najłatwiejszy w sprzedaży lead dla web-studia.

- **Google Places API (New)** — `GOOGLE_PLACES_API_KEY`. Wyszukiwanie „kategoria w mieście"; API wprost zwraca, czy firma ma stronę (`websiteUri`), telefon, ocenę i liczbę opinii. Profile firmowe na Facebooku traktowane są jak brak realnej strony.
- **CEIDG** (`dane.biznes.gov.pl`) — `CEIDG_API_TOKEN` (darmowy JWT). Świeżo zarejestrowane firmy z ostatnich 30 dni — dopiero startują i potrzebują wszystkiego.
- **Bez kluczy** działa deterministyczny mock (przykładowe polskie firmy), więc cały flow można przetestować offline.

Wyniki zaznaczasz checkboxami i **importujesz jako leady** (wspólny pipeline: dedup → scoring → opcjonalny draft AI → opcjonalny audyt strony). Firmy bez strony dostają tag `no-website` i priorytet HIGH. Zapisane wyszukiwania (`kategoria @ miasto`) może odpalać **autopilot** w każdym ticku (przełącznik „Enable automatic prospecting").

**Endpointy:** `POST /api/prospecting/search`, `POST /api/prospecting/import`.

---

## Audyt stron WWW (kwalifikacja „na modernizację")

Każdy lead ze stroną może dostać **audyt zdrowia strony** (panel na karcie leada + job `audit-websites` w ticku autopilota):

- **Google PageSpeed Insights** (darmowe; `PAGESPEED_API_KEY` tylko podnosi limit) — performance/SEO/best-practices/accessibility, LCP, viewport, HTTPS.
- **Fallback heurystyczny** (bez zależności) — czas odpowiedzi, HTTPS, viewport, title/description/H1.

Wynik (0–100) zapisuje się na leadzie (`auditScore`), słabe strony (<50) dostają tag `modernization`, a **konkrety z audytu („strona ładuje się 8,4 s", „brak HTTPS") trafiają do promptów AI** — sekwencje piszą wiadomości odwołujące się do faktów, nie spam.

**Endpoint:** `POST /api/leads/[id]/audit`.

---

## Telefonowanie — kolejka, notatki, statusy

Strona **Calls** (`/calls`) to kolejka telefoniczna: najlepsze leady z numerem na górze, z podpowiedziami z audytu („o czym mówić"). Jedno kliknięcie = `tel:` link; po rozmowie logujesz wynik jednym z statusów: *No answer, Voicemail, Callback scheduled, Interested, Not interested, Meeting booked, Wrong number* + notatka („gdzie zadzwoniłem, co wiem") + termin następnej próby (status `CALLBACK` tworzy automatycznie zadanie).

Historia rozmów (`CallLog`) jest też widoczna na karcie leada; aktualny status/licznik prób mirrorowany na leadzie napędza filtry list.

**Endpointy:** `GET/POST /api/leads/[id]/calls`.

---

## Karta bojowa leada (playbook sprzedażowy)

Po wejściu w leada, na samej górze, widzisz **Battle card** — wszystko czego potrzebujesz, żeby go przejąć:

- **Where to hit** — najmocniejszy punkt uderzenia wyliczony z danych: *brak strony („niewidoczny w Google")*, *strona ładuje się X s*, *„Not secure" w przeglądarce*, *nie działa na telefonie*, *świeżo zarejestrowana firma*. Najmocniejszy kąt oznaczony badge „strongest" + **gotowy opener rozmowy** odwołujący się do konkretów.
- **Where we stand** — przejrzysta checklista: zadzwoniono (ile razy, ostatni wynik), e-mail wysłany, audyt zrobiony, spotkanie umówione, oferta wysłana + najlepsze okna na telefon (wt–czw 9–11 / 15–17).
- **How to win them** — 2–3 kolejne ruchy dopasowane do statusu (inne po „nie odebrał", inne po „zainteresowany", inne po „spotkanie umówione"), oparte o badania cold outreach: darmowy mini-audyt jako stopa w drzwiach, multi-channel (+37% odpowiedzi), wycena w 24 h od „zainteresowany", 3 opcje cenowe, deadline przy zamykaniu. Przy 3–5 kontaktach przypomina: **93% konwersji następuje od 6. kontaktu**.
- **Objection cheat sheet** — gotowe odpowiedzi na klasyki: „mam klientów z polecenia", „za drogo", „bratanek mi zrobi", „mam Facebooka", „nie mam czasu".

Silnik jest deterministyczny (`src/lib/playbook.ts`) — działa bez AI i bez kluczy, zawsze z faktów o leadzie.

---

## Wysyłka e-maili (naprawdę)

- **Zatwierdzenie draftu w `/approvals` wysyła e-mail** do leada (jeśli ma adres): Resend (`RESEND_API_KEY`) lub Mailgun (`MAILGUN_API_KEY` + `MAILGUN_DOMAIN`), nadawca z `EMAIL_FROM`. Bez kluczy wysyłka jest **symulowana** i wyraźnie oznaczona — flow pozostaje testowalny.
- **Pełna automatyzacja (opt-in):** przełącznik „Auto-send approved emails" w ustawieniach Autopilota — drafty e-mail są auto-zatwierdzane i wysyłane do dziennego limitu (`Daily email cap`), z poszanowaniem godzin ciszy. Domyślnie WYŁĄCZONE (human-in-the-loop).
- Każda wysyłka: `sentAt` na wiadomości, wpis `EMAIL` w aktywności, `lastContactedAt`, licznik kampanii i metryka dnia `emails.sent`.

---

## Social Studio — reklamy i posty (Facebook / Instagram / Google)

Strona **Social Studio** (`/social`): AI generuje reklamę lub post pod wybrany kanał (hook, treść, CTA, hashtagi — z kontekstem firmy i ofertą), Ty edytujesz i **publikujesz teraz albo planujesz** (zaplanowane posty publikuje autopilot/cron).

- **Facebook** — Meta Graph API: `META_ACCESS_TOKEN` + `FACEBOOK_PAGE_ID` (post na stronie, z linkiem).
- **Instagram** — `META_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ID` (wymaga `imageUrl`).
- **Google Business Profile** — `GBP_ACCESS_TOKEN` + `GBP_LOCATION_ID` (local post z CTA).
- **LinkedIn** — eksport copy (przycisk kopiowania).
- Bez tokenów publikacja jest **symulowana** (status `PUBLISHED (simulated)`), więc cały flow działa w demo.

**Endpointy:** `POST /api/social/generate`, `GET /api/social/posts`, `PATCH/DELETE /api/social/posts/[id]`, `POST /api/social/posts/[id]/publish`.

---

## Automatyzacje / joby w tle

W `src/jobs/` znajdują się gotowe joby:

- **discover-leads** — outbound: dociąga prospektów z ICP (mock lub realny dostawca).
- **enrich-leads** — uzupełnia dane nowych leadów (domena, wartość) i przelicza scoring.
- **audit-websites** — audytuje strony WWW leadów (PageSpeed/heurystyka) i taguje „modernization".
- **advance-sequences** — przesuwa wymagalne kroki sekwencji do kolejki akceptacji.
- **send-approved-emails** — (opt-in) auto-wysyłka draftów e-mail do dziennego limitu.
- **publish-social** — publikuje zaplanowane posty social, którym minął termin.
- **detect-hot-leads** — flaguje leady ≥ progu i tworzy powiadomienia.
- **performance-alerts** — alerty o spadku reply rate + sugestie dot. lejka.
- **weekly-report** — generuje raport tygodniowy + powiadomienie (endpoint `POST /api/reports/weekly`).

Scoring nowego leada, next-best-action, generowanie draftów i zadania follow-up działają w warstwie API przy odpowiednich akcjach.

---

## Prywatność i dane (GDPR / RODO)

- **Soft-delete** leadów (`deletedAt`) — dane nie znikają natychmiast, jest ślad audytowy.
- **Dziennik decyzji AI** (`AiDecisionLog`) — pełna audytowalność tego, co i czym zostało wygenerowane.
- **Human-in-the-loop** — żadna wiadomość nie wychodzi bez akceptacji człowieka (kolejka Approvals).
- **Sanityzacja** danych leada przed przekazaniem do dostawcy AI (`src/lib/ai/prompts.ts`).
- Brak spamu z założenia — system wspiera proces, nie masową wysyłkę.

---

## Struktura projektu (skrót)

```
prisma/
  schema.prisma        # 20 encji, multi-tenant po Company
  seed.ts              # realistyczne dane demo (idempotentny)
src/
  app/
    (auth)/            # login, register
    (app)/             # dashboard, leads, pipeline, tasks, campaigns,
                       # generator, templates, approvals, analytics,
                       # copilot, settings
    api/               # wszystkie endpointy REST
  components/          # UI (shadcn), wykresy, komponenty domenowe
  lib/                 # auth, prisma, scoring, next-best-action,
                       # metrics, walidacje, warstwa AI (adapter/mock/prompts)
  jobs/                # joby w tle
  store/               # Zustand (stan UI)
```

---

## Uwagi dot. budowania

- `npm run build` uruchamia `prisma generate && next build`.
- Strony zalogowane są renderowane dynamicznie (`force-dynamic`), bo czytają sesję i dane firmy.
- Multi-tenant: każde zapytanie jest filtrowane po `companyId`.

---

## Roadmap (kolejne kroki)

- Eksport danych i „prawo do bycia zapomnianym" (endpointy RODO) z poziomu UI.
- Realna wysyłka e-maili po akceptacji (integracja SMTP/ESP).
- Drag-and-drop na tablicy pipeline.
- Import leadów z CSV (webhooki i formularze WWW już są — zob. Autopilot).
- Trwały rate-limit (Redis) dla publicznych endpointów zamiast in-memory.
- Role i uprawnienia (OWNER/ADMIN/MEMBER) egzekwowane na poziomie API.
- Zaplanowane joby (cron/queue): dostępne przez `POST /api/cron` (+ `vercel.json`) oraz scheduler in-process; docelowo kolejka (QStash/BullMQ) dla większej skali.

---

Zbudowane jako kompletny fundament produkcyjny — gotowy do uruchomienia, rozwoju i podłączenia prawdziwego modelu AI.
