# JARVIS — Postęp prac (Faza 2)

Bazowo: 665 testów zielone. Każda partia: zmiana → test/build → commit.

## Plan napraw (bezpieczne, wysoki wpływ, niskie/średnie ryzyko)

### Batch 1 — BFF `proxy/worker.js`
- [ ] (C) REALNY BUG: `b64` niezdefiniowane w `/v1/gmail/send` → 500 na PL tematach — dodać moduł-globalny `b64`.
- [ ] (M3) Sanityzacja CRLF w SMTP/MIME (`to/user/subject/inReplyTo`).
- [ ] (M4) Klucz Gemini z URL → nagłówek `x-goog-api-key` (`/v1/embed`, `/gemini`).
- [ ] (M6) Cap długości `texts[]` w `/v1/embed`.
- [ ] (m1) Timeouty na upstream-fetchach workera.
- [ ] (M5) 500 → generyczny komunikat (bez `String(e)`).

### Batch 2 — sales-os public API
- [ ] (C1) Per-lead outreach: gate na `autoSendEmails` + `dailyEmailCap`.
- [ ] (C2) Rate-limit wysyłki: klucz na sam token (bez `X-Forwarded-For`).
- [ ] (M2) Token min. długość 24.
- [ ] (m6) Timeout na fetch w `email/index.ts`.

### Batch 3 — klient: głos + store + backup + bezpieczeństwo
- [ ] (Voice D) `playUrlWithLevel` — odłączać węzły audio (lub kierować przez `playUrlEnded`).
- [ ] (Voice M4) Backoff + give-up na restart Web Speech.
- [ ] (Voice m2/m6) `loadVoices` cleanup + `speakToken` guard w gałęziach Fish/ElevenLabs.
- [ ] (Data E) `backup.ts` — walidacja/whitelist ustawień przy imporcie (pola-endpointy).
- [ ] (Store M4/M5) Quota: głośny trwały sygnał + capy `memory`/`sentMail`/`contentPosts`.
- [ ] (Audit M4) Redakcja `input` w `audit()`.
- [ ] (m1) `ErrorBoundary` — decay licznika restartów.

### Batch 4 — Electron
- [ ] (M4) `will-navigate` guard + `sandbox:true` + `isTrustedIpc` na google/smtp/notify.
- [ ] (m3) DevTools tylko gdy `!app.isPackaged`.

### Batch 5 — leady + LeadDetail
- [ ] (M3) Overpass: timeout per-mirror 12s.
- [ ] (m4) `LeadDetail` — `window.open(lead.url)` przez wspólny guard http/https.
- [ ] (m3) `parseElement` — limity długości pól.

### Batch 6 — krypto + CI
- [ ] (cipher m4) Zapis `iter`+wersji w nagłówku `JV1:` (wstecznie zgodnie).
- [ ] (CI M2) Usunąć martwe bloki `JARVIS_*_KEY` + mylące komentarze z workflowów.

## DO MOJEJ DECYZJI (nie wdrażam) — patrz AUDIT.md §9

## Zrobione
(uzupełniane na bieżąco)
