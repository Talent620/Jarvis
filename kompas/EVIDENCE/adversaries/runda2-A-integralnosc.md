# Adwersarz A (integralność) — runda 2 (powtórkowa)

## Werdykty
- **A1 (inline w eksporcie): ZAMKNIĘTA z rezydualnym ryzykiem** — regex łapał tylko \r\n;
  U+2028/U+2029/NEL/\v\f przechodziły nietknięte (w pliku .md to nadal jedna linia, ale
  niektóre edytory renderują U+2028 jako łamanie). → NAPRAWIONE: klasa rozszerzona
  o U+2028/U+2029/NEL/\v\f + wariant U+2028 w teście regresji.
- **A2 (walidacja linku): OBCHODZONA** — `https://.`, `http://#`, `http://:` przechodziły
  regex `[^\s/]+`; case-sensitive odrzucał poprawny `HTTP://…`. → NAPRAWIONE: parsowanie
  `new URL()` + wymóg znaku alfanumerycznego w hostname; warianty w teście regresji.
- **Pre-check w closeAction: ZAMKNIĘTA** (brak osieroconych artefaktów; S08/S09 nienaruszone).
- **resolveBet AND status='active': ZAMKNIĘTA z latentną luką kontraktu** — cichy no-op
  (0 wierszy) dla przyszłych wywołujących. → NAPRAWIONE: `rowsModified()===0` → Error.
- Defense-in-depth: UPDATE w closeAction trafiający 0 wierszy → NAPRAWIONE: rzut w batchu
  (ROLLBACK całości — dowód nie zostaje osierocony).

## Nowe problemy wprowadzone przez naprawy rundy 1
Brak.
