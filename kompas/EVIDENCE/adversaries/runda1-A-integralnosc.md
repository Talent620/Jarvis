# Adwersarz A (integralność) — runda 1

## ZNALEZISKA

### A1 (WYSOKIE) — Eksport markdown KŁAMIE: wstrzyknięcie fałszywej linii „- [x]” przez znak nowej linii w tekście użytkownika
Plik: `src/lib/exportMd.ts:79, 86-88, 96-101` (źródła: textarea w Today/Week/Bet).
Tekst użytkownika trafia do markdownu surową konkatenacją bez escapowania; `trim()` nie
usuwa wewnętrznych `\n`. Wpis o treści zawierającej linię `- [x] … — dowód: notatka (…)`
tworzy w eksporcie linię nieodróżnialną od realnie domkniętego działania → złamanie
zasady „eksport nigdy nie kłamie”. Analogicznie `bet.text`/`prediction`/`learned` mogą
wstrzyknąć fałszywe nagłówki `###`.
Naprawa minimalna: zamiana `\r?\n` na spację we wszystkich polach użytkownika przy budowie linii.

### A2 (ŚREDNIE) — Link „http://” (sam prefiks) przechodzi walidację dowodu
Plik: `src/lib/bets.ts:123-127`. Walidacja sprawdza tylko prefiks — `"http://"` bez hosta
ustawia done_at+proof_id → „zrobione” bez faktycznego dowodu.
Naprawa minimalna: wymóg niepustego hosta (`^https?:\/\/[^\s/]+`).

## Drobne (nieblokujące)
- `resolveBet` bez `AND status='active'` — przez UI nieosiągalne, ale funkcja pozwala
  nadpisać werdykt rozstrzygniętego zakładu.
- `closeAction` przy już domkniętym działaniu wstawia osierocony proof (UPDATE trafia 0 wierszy).

## ZBADANE — BEZ LUKI
Wyścig dwóch kliknięć na regule 1 aktywnego zakładu (synchroniczne createBet, brak okna);
inne ścieżki UPDATE na done_at (tylko closeAction); podrobienie przewidywania (brak UPDATE
prediction); podrobienie znaczników czasu z UI; notatka z samych spacji / plik 0 B / typ
spoza unii; osierocony proof_id→[x] (warunek done spójny w UI/eksporcie/liczniku);
wyciek klucza API (tylko nagłówek x-api-key); XSS/javascript: w linku (filtr prefiksu + React).
