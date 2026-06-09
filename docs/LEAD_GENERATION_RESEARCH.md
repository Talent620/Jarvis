# Research: Automatyczne narzędzie do pozyskiwania klientów na strony internetowe

Data: czerwiec 2026 · Status: analiza wykonalności (feasibility study)

## 1. Koncepcja

Pełny pipeline automatyzacji sprzedaży stron internetowych:

```
[Źródła danych] → [Kwalifikacja leadów] → [Wzbogacanie] → [Outreach] → [Reklamy] → [CRM / follow-up]
   Google Maps        brak strony /         e-mail, tel,     e-mail,      Google Ads,    statusy,
   CEIDG / REGON      słaba strona          NIP, branża      LinkedIn,    Meta Ads       odpowiedzi,
                      (audyt auto)                           formularze                  umówione calle
```

Werdykt ogólny: **technicznie wykonalne w całości, ale pełna automatyzacja cold mailingu
jest w Polsce prawnie ryzykowna** (PKE od 11.2024). Najlepszy realny model to
automatyzacja 90% procesu (znajdowanie, kwalifikacja, personalizacja, przygotowanie
wiadomości) z legalnym kanałem dotarcia.

---

## 2. Pozyskiwanie leadów — co działa

### Google Maps / Places (najlepsze źródło)
Firmy bez strony WWW widać wprost w profilu Google Maps. Gotowe rozwiązania:

| Narzędzie | Model | Uwagi |
|---|---|---|
| [Apify – Businesses Without Websites Scraper](https://apify.com/xmiso_scrapers/businesses-without-websites-leads-scraper-google-maps) | pay-per-result | gotowy aktor dokładnie pod ten use case |
| [Outscraper](https://outscraper.com/google-maps-scrape-businesses-without-websites/) | API + no-code, darmowy tier | nazwa, telefon, e-mail, recenzje, filtr "bez strony" |
| [Scrap.io](https://scrap.io/) | SaaS | dane z Map + social media |
| Google Places API (oficjalne) | $/request | legalne, ale limit ~60 wyników na zapytanie i brak e-maili |

Skala rynku: wg badań z 2024 r. ok. **36% małych firm w USA nie ma strony WWW**
([B2BLeadFinder](https://b2bleadfinder.io/blog/how-to-find-businesses-without-websites)) —
w Polsce odsetek w segmencie mikro (usługi lokalne, rzemiosło) jest podobny lub wyższy.

### Polskie rejestry publiczne (darmowe, legalne)
- **[API REGON (GUS, BIR1.1)](https://api.stat.gov.pl/Home/RegonApi)** — darmowe, wystarczy
  wniosek na regon_bir@stat.gov.pl; wyszukiwanie po PKD/lokalizacji → świeżo
  zarejestrowane firmy z branż "stronochłonnych".
- **[Hurtownia danych CEIDG](https://dane.biznes.gov.pl/)** — API v2, dane JDG łącznie
  z adresami; świeże wpisy = firmy, które dopiero startują i potrzebują strony.
- Strategia: codzienny cron pobiera nowe wpisy CEIDG z wybranych PKD → sprawdzenie,
  czy firma ma stronę (Google Search / Maps) → lead.

### Kwalifikacja i scoring (w pełni automatyzowalne)
- Brak strony w profilu Maps → lead "gorący".
- Strona istnieje, ale: brak HTTPS, brak wersji mobilnej, PageSpeed < 40
  (darmowe **Google PageSpeed Insights API / Lighthouse**) → lead "modernizacja".
- Scoring: liczba recenzji (firma aktywna), branża, wiek wpisu CEIDG.

---

## 3. Wysyłanie e-maili — tu jest główne ryzyko

### Stan prawny w Polsce (kluczowe!)
Od **10 listopada 2024** obowiązuje Prawo Komunikacji Elektronicznej (PKE):

- Wysyłka treści marketingowych e-mailem **wymaga uprzedniej zgody odbiorcy** —
  **również w B2B** (przepis nie rozróżnia B2C/B2B)
  ([iSecure](https://www.isecure.pl/blog/cold-mailing-a-regulacje-rodo-i-nowe-prawo-komunikacji-elektronicznej/),
  [MDL Kancelaria](https://mdl-kancelariaprawna.pl/porady-prawne/cold-calling-i-cold-mailing-w-swietle-nowego-prawa-komunikacji-elektronicznej-co-musisz-wiedziec/)).
- Kara: **do 3% przychodu lub 1 mln zł** (wyższa z kwot)
  ([Legalna-Baza](https://legalna-baza.pl/cold-mailing-b2b-kiedy-jest-legalny-a-kiedy-nie-praktyczny-przewodnik-po-rodo-i-prawie-telekomunikacyjnym/)).
- RODO (uzasadniony interes) **nie zastępuje** zgody z PKE — to dwa osobne reżimy.

**Legalne / niskoryzykowne kanały dotarcia:**
1. **Dwustopniowy mailing** — pierwszy mail to wyłącznie neutralne pytanie o zgodę na
   przesłanie oferty (bez treści marketingowej). Praktyka rynkowa, ale "szara strefa" —
   część prawników uznaje samo zapytanie za marketing. Niskie ryzyko przy małej skali.
2. **Formularz kontaktowy firmy** — wiadomość przez formularz na stronie/profilu to
   indywidualny kontakt, nie masowa wysyłka (większość leadów i tak nie ma strony,
   więc ograniczone zastosowanie).
3. **LinkedIn outreach** — regulamin LinkedIn zakazuje automatyzacji, ale
   półautomatyczne (przygotowane wiadomości, ręczna wysyłka) jest bezpieczne prawnie.
4. **Telefon** — też wymaga zgody wg PKE, ale w praktyce "czy mogę przedstawić ofertę?"
   na początku rozmowy jest standardem rynkowym.
5. **Inbound przez reklamy** (patrz §5) — w pełni legalny i skalowalny.

### Wymogi techniczne (Gmail/Yahoo, egzekwowane od XI 2025)
Jeśli wysyłamy maile (nawet za zgodą), to od listopada 2025 Gmail **trwale odrzuca
(błąd 550)** niezgodną pocztę
([Proofpoint](https://www.proofpoint.com/us/blog/email-and-cloud-threats/clock-ticking-stricter-email-authentication-enforcements-google-start)):

- SPF + DKIM + DMARC obowiązkowe (alignment dla bulk senderów),
- spam rate < 0,1% (max 0,3%),
- one-click unsubscribe, usuwanie wypisanych w ≤ 2 dni,
- praktyka cold-mailingowa: osobne domeny wysyłkowe (nie główna!), warm-up 2–4 tyg.,
  20–50 maili/dzień/skrzynkę, rotacja skrzynek.

---

## 4. Personalizacja AI (duża przewaga, w pełni automatyzowalna)

- Claude API generuje spersonalizowaną wiadomość na bazie danych leada:
  branża, recenzje z Maps, wynik audytu strony ("Państwa strona ładuje się 9 s na
  telefonie…", "Konkurent X z tej samej ulicy ma stronę i 2× więcej recenzji…").
- Automatyczny **mini-audyt PDF / mockup strony** jako załącznik/landing — to realnie
  podnosi konwersję i odróżnia od spamu.
- Koszt znikomy: ~1500 tokenów/lead.

---

## 5. Automatyzacja reklam

Dwa różne scenariusze:

**A. Reklamy promujące NASZE usługi (inbound)** — najprostsze i legalne:
- Google Ads API: token developerski działa od razu na kontach testowych; poziom
  **Explorer** (2 880 operacji/dzień) dostępny od ręki, Basic/Standard po zatwierdzeniu
  ([Google](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)).
- Meta Marketing API: wymaga konta developerskiego, Business Managera i **weryfikacji
  firmy**; uprawnienia `ads_management`
  ([Meta](https://developers.facebook.com/docs/marketing-api/get-started/authorization)).
- Automatyzacja: generowanie kampanii lokalnych ("strony www Kraków") per region/branża.

**B. Targetowanie zebranych leadów (custom audiences z e-maili)** — **ryzykowne wg RODO**
(wgranie cudzych e-maili do Meta bez zgody = przekazanie danych osobowych). Odradzane.

---

## 6. Istniejące narzędzia — kupić czy budować?

| Narzędzie | Rola | Cena (2026) |
|---|---|---|
| [Instantly](https://litemail.ai/blog/cold-email-tool-pricing-comparison-2026) | wysyłka cold e-mail, warm-up, AI copilot | od $37/mc (realnie ~$135/mc ze stackiem) |
| [Apollo](https://www.devcommx.com/blogs/clay-vs-apollo-vs-instantly-comparison) | baza B2B + sekwencje | od $59/user/mc |
| [Clay](https://www.devcommx.com/blogs/clay-vs-apollo-vs-instantly-comparison) | wzbogacanie danych, orkiestracja | od ~$167/mc |
| Outscraper / Apify | scraping Maps | pay-per-use, od ~$0 |

Wniosek: **nie budować wysyłki od zera** (deliverability to osobna dziedzina) —
własną wartością jest pipeline: polskie źródła (CEIDG/REGON) + audyt stron + scoring
+ personalizacja AI; wysyłkę delegować do Instantly (ma API) lub robić półautomatycznie.

---

## 7. Co realnie jesteśmy w stanie zbudować (roadmapa)

### MVP (1–2 tygodnie pracy)
1. **Kolektor leadów**: Outscraper/Apify API (Maps, filtr "bez strony") + cron na nowe
   wpisy CEIDG po PKD → baza (Postgres/SQLite).
2. **Audytor**: PageSpeed API + sprawdzenie HTTPS/mobile → scoring leada.
3. **Generator wiadomości**: Claude API → spersonalizowany draft + mini-audyt.
4. **Panel** (prosty web UI): lista leadów, score, draft do akceptacji **jednym
   kliknięciem** (człowiek w pętli = bezpieczeństwo prawne i jakość).

### Etap 2 (miesiąc)
5. Integracja Instantly API (sekwencje, follow-upy, tracking odpowiedzi) — wysyłka
   w modelu dwustopniowym (najpierw pytanie o zgodę).
6. Automatyczne landing pages / mockupy per lead ("tak mogłaby wyglądać Państwa strona").
7. CRM: statusy, przypomnienia, kalendarz.

### Etap 3
8. Google Ads API: automatyczne kampanie lokalne per miasto/branża (inbound).
9. Skoring ML na bazie historii odpowiedzi.

### Koszty operacyjne MVP
- Scraping: ~$30–100/mc · Maile (Instantly + domeny + skrzynki): ~$80–150/mc
- AI: <$20/mc · Hosting: ~$10–20/mc → **łącznie ~$150–300/mc**

---

## 8. Główne ryzyka

| Ryzyko | Waga | Mitygacja |
|---|---|---|
| PKE — masowy cold mailing bez zgody | **wysokie** (do 1 mln zł) | model dwustopniowy, mała skala, człowiek w pętli, kanały alternatywne |
| Deliverability (blokady Gmail od XI 2025) | wysokie | osobne domeny, SPF/DKIM/DMARC, warm-up, limity |
| TOS Google (scraping Maps) | średnie | ryzyko po stronie dostawcy (Outscraper/Apify); oficjalne Places API jako fallback |
| Niska konwersja cold outreach (typowo 1–5% odpowiedzi) | średnie | personalizacja AI + audyt/mockup, dosprzedaż przez telefon |
| Weryfikacja w Meta/Google Ads API | niskie | proces formalny, wymaga zarejestrowanej firmy |

## 9. Rekomendacja

Budować **półautomatyczny pipeline z człowiekiem w pętli**: pełna automatyzacja
znajdowania, kwalifikacji, audytu i pisania wiadomości; wysyłka zatwierdzana jednym
kliknięciem i prowadzona w modelu dwustopniowym + równolegle inbound z automatycznych
kampanii Google Ads. To daje ~95% oszczędności czasu przy akceptowalnym ryzyku prawnym.
