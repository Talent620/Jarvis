# KOMPAS — playbook sprzedaży (od kodu do pierwszych płacących)

> Dokument biznesowy — NIE zmienia produktu (FAZA 6 zamknięta i zamrożona).
> Cel: przejść z „kod wart kilkanaście tys." do „produkt z trakcją" najkrótszą drogą.

## 0. Decyzja: dlaczego KOMPAS pierwszy (nie JARVIS)

| Kryterium | KOMPAS | JARVIS |
|---|---|---|
| Gotowość | DONE: 12/12 scenariuszy, audyt, FINAL.md | szeroki, wiele frontów |
| Wdrożenie | statyczna PWA — hosting w 1 dzień | APK/EXE, klucze API, onboarding |
| Obietnica | JEDNO zdanie (niżej) | trudna do streszczenia |
| Koszt utrzymania | ~zero (bez backendu) | ciągły |
| Ryzyko | niskie | S9/WebView/API |

JARVIS to akt drugi: „silnik osobisty" dla tych, którym KOMPAS udowodni, że dowozisz.

## 1. Obietnica (jedno zdanie)

**„KOMPAS domyka Twoje decyzje: żadne działanie nie jest »zrobione«, dopóki nie pokażesz
dowodu — a po tygodniu widzisz czarno na białym, czy Twój plan działa."**

Pozycjonowanie: NIE „kolejny planer/journal". To **system anty-ściemowy** dla jednej
osoby: wpis dzienny → wzorzec tygodnia → JEDEN zakład → działania z dowodem → wynik vs
przewidywanie. Wróg nazwany wprost: *lista zadań, która kłamie*.

Grupa docelowa (start, wąsko): **polscy solo-przedsiębiorcy i freelancerzy**, którzy
„dużo planują, mało domykają". Nie „wszyscy zainteresowani produktywnością".

## 2. Cennik (prosto, bez kombinowania)

- **7 dni pełnej wersji za darmo** (bez karty — dane i tak są lokalnie u użytkownika).
- **29 zł/mies.** albo **240 zł/rok** (2 miesiące gratis). Jedna wersja, zero tierów.
- Kanał płatności: Stripe Payment Links (działa w PL, zero kodu) albo EasyCart.
- Mechanika dostępu na start: zakup → mail z linkiem do aplikacji + instrukcją
  instalacji PWA. Bez kont i backendu — na tym etapie „piractwo" to nie problem,
  problem to brak użytkowników.

Progi szczerości: 10 płacących = 290 zł/mies. To nie utrzymanie — to **dowód popytu**,
który zmienia wycenę całego repo o rząd wielkości.

## 3. Plan 30 dni do 10 płacących

**Tydzień 1 — wystawienie (1–2 dni pracy):**
1. Hosting: Cloudflare Pages / Netlify (`npm run build` → katalog `dist/`). Domena
   ~50 zł/rok (np. kompas.app.pl / getkompas.pl).
2. Landing = JEDNA strona: obietnica, 3 zrzuty (są gotowe w `EVIDENCE/vision/final/`),
   przycisk „Wypróbuj 7 dni”, cena. Zero bloga, zero „funkcji AI” na froncie.
3. Ty sam używasz KOMPAS-u codziennie od dziś — Twoje prawdziwe zamknięte pętle
   to jedyny marketing, który nie brzmi jak reklama.

**Tydzień 2–3 — 30 rozmów, nie „marketing":**
- Kanały: LinkedIn PL (posty „pokazuję swój tydzień w KOMPAS-ie” + DM), grupy FB dla
  freelancerów/solo (te, w których już bywasz), 5 znajomych przedsiębiorców osobiście.
- Skrypt DM (krótki): *„Robię narzędzie dla ludzi, którzy dużo planują i mało domykają.
  Jedno działanie = jeden dowód, bez dowodu nie ma »zrobione«. Dasz mu 7 dni i powiesz
  mi, gdzie kłamie?"* — prosisz o FEEDBACK, nie o zakup; zakup przychodzi po.
- Cel liczbowy: 30 realnych rozmów → ~15 prób → 5–10 płacących. Jeśli po 30 rozmowach
  0 płacących — **nie dobudowuj; zapytaj DLACZEGO nie używali** (bramka z FINAL.md).

**Tydzień 4 — pętla dowodu:**
- Każdemu płacącemu: 15-min rozmowa „co przeszkadza”. Zmieniasz TYLKO to, co blokuje
  płacących (nie życzenia darmowych).
- Publikujesz własny eksport .md z 30 dni (z dowodami) — „tak wygląda miesiąc, który
  się nie okłamuje”. To jest content, którego konkurencja nie podrobi.

## 4. Drabina wyceny (co odblokowuje kolejny próg)

| Stan | Realna wartość | Co odblokowuje próg |
|---|---|---|
| Dziś: kod + audyt | 15–60 tys. zł (jeśli trafi się kupiec) | — |
| 10 płacących | pierwszy mnożnik ARR | 30 rozmów z planu wyżej |
| 50 płacących (~17 tys. zł ARR) | ~40–70 tys. zł jako biznes | powtarzalny kanał (1 działający) |
| 200 płacących (~70 tys. ARR) | 180–280 tys. zł | churn <5%/mies., onboarding samoobsługowy |
| + JARVIS jako „PRO” dla najlepszych | premia za unikalne IP | Dziennik Predykcji jako feature PRO |

## 5. Czego NIE robić (koszt alternatywny)
- Nie sprzedawać repo „na zimno” — poniżej 10 płacących każda oferta będzie niska.
- Nie budować kont/backendu/synchronizacji przed 10 płacącymi.
- Nie odpalać dwóch produktów naraz — JARVIS czeka, aż KOMPAS da dowód popytu.
- Nie mówić „AI” w nagłówku — obietnicą jest DOWÓD, nie technologia.

## 6. Rola JARVIS-a w tej strategii
JARVIS pozostaje Twoim silnikiem osobistym i poligonem (Dziennik Predykcji, Sztafeta).
Gdy KOMPAS ma płacących: (a) Dziennik Predykcji staje się feature'em PRO („KOMPAS
przewiduje, kiedy porzucisz zakład — i mówi to wprost"), (b) case study JARVIS-a
buduje Twoją markę osoby, która NAPRAWDĘ buduje. Sprzedaż JARVIS-a jako całości ma
sens dopiero jako acqui-hire albo licencja B2B — po trakcji KOMPAS-u.
