# CONTINUE

- GAŁĄŹ SESJI: `claude/intelligent-brahmagupta-jq7jqj`
  (local test: `git fetch origin claude/intelligent-brahmagupta-jq7jqj && git checkout claude/intelligent-brahmagupta-jq7jqj`)
- PR: https://github.com/Talent620/Jarvis/pull/7 (draft)
- OSTATNI ZIELONY COMMIT: `a01422e` in CI (Tests push 36072124283, pull_request 36072128238);
  `301098a` (Gmail MailService) green locally, CI pending at the time of writing.
- BIEŻĄCY KAMIEŃ: M5 (streaming voice runtime). M0-M4 done (M4 on fixtures).
- STAN TESTÓW: vitest 3159/3159 (349 files); browser suite 14/14 (golden 1-7 x10,
  golden 1-8 x10, no-id variant, conversations, ManagedBrowser hardening).
- OSTATNIA ZWERYFIKOWANA FUNKCJA: golden scenario 1-8 on Chromium with the YouTube fixture and a
  mock Gmail, one consent, mail CONFIRMED from Sent, 10 consecutive green runs, also in CI.
- DOKŁADNA NASTĘPNA AKCJA: M5. Streaming voice behind interfaces (mission 5.14): STT partial/final
  stream -> JarvisRuntime.onPartial/onFinal, TTS with immediate cancel on barge-in, echo
  suppression, dedup of finals, provider catalog replacing the dead Gemini Live id (optional
  gemini-3.8-live adapter), latency timestamps (partial, intent, cancel signal, action start,
  verification, first chat token, first TTS audio). Tests on synthetic and recorded event streams.
- LOCAL RUN: `npm ci && npm run test:browser` (needs Chromium: `npx playwright install chromium`).
- POZYCJE NEEDS_HARDWARE: B-030 real YouTube selectors, B-031 real Gmail send + Sent read-back,
  B-032 address book source. All for M6 acceptance on the user machine.
- POZYCJE BLOCKED: none.
- OWNER ACTION: set `JARVIS_RELEASE_STORE_PASSWORD` / `JARVIS_RELEASE_KEY_PASSWORD` secrets before
  the next release (release.yml refuses to publish without them, docs/JARVIS-SECURITY.md).

## Recovery checklist
1. `cat CLAUDE.md docs/mission/CONTINUE.md docs/mission/state.json`
2. `git log --oneline -20`
3. Latest CI run for the branch (GitHub MCP `actions_list`), failed logs only.
4. Newest `reports/acceptance-*.md`, if any, before the backlog.
