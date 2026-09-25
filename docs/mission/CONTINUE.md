# CONTINUE

- GAŁĄŹ SESJI: `claude/intelligent-brahmagupta-jq7jqj`
  (local test: `git fetch origin claude/intelligent-brahmagupta-jq7jqj && git checkout claude/intelligent-brahmagupta-jq7jqj`)
- PR: https://github.com/Talent620/Jarvis/pull/7 (draft)
- OSTATNI ZIELONY COMMIT: `4599b20` locally (all gates exit 0); CI green on `13ebcbd` (Tests with
  test, browser and desktop jobs; Android APK; Ubuntu build). CI for the M10 commits: check the
  latest run of the branch.
- BIEŻĄCY KAMIEŃ: none. M0-M10 done (state.json); what is left needs the user's machine.
- STAN TESTÓW (after 4599b20): vitest 3282/3282 (361 files); browser 17/17; desktop on Xvfb 8/8;
  tsc -b, eslint ., npm run build, npm run scan:secrets exit 0. Golden 1-8 on the fixture 10
  consecutive green runs (1.3-1.6 s each). Acceptance fixture x10:
  reports/acceptance-2026-09-25T01-36-38-962Z.md.
- OSTATNIA ZWERYFIKOWANA FUNKCJA: final adversarial review fixes (D-032): vision only for real
  clicks, tool timeouts never retried and UNKNOWN unless the read-back proves them, desktop
  selection read from the desktop, bridge tokens bound to the Origin extension id.
- DOKŁADNA NASTĘPNA AKCJA: on the user machine run
  `npm ci && npm run jarvis:acceptance -- --mode=local-desktop`, then
  `--mode=managed-browser` (real YouTube). Read the newest reports/acceptance-*.md before the
  backlog. Then B-034 (voice toggle in the UI), B-035 (route "w mojej przeglądarce" to the
  bridge), B-038 (a real vision model), B-039 (skills UI).
- LOCAL RUN: `npm ci && npm run test:browser && npm run jarvis:acceptance`.
- POZYCJE NEEDS_HARDWARE: B-030 real YouTube selectors, B-031 real Gmail send + Sent read-back
  (`--send` only), B-032 address book source, B-033 voice on a real microphone, B-036 Firefox
  run of the bridge extension, B-037 Wayland input through the RemoteDesktop portal, Windows
  desktop run, Android phone run.
- POZYCJE BLOCKED: none (YouTube and ai.google.dev are blocked only from the cloud session by
  network policy; the gemini-3.8-live id is unverified, D-026).
- OWNER ACTION: set `JARVIS_RELEASE_STORE_PASSWORD` / `JARVIS_RELEASE_KEY_PASSWORD` secrets before
  the next release (release.yml refuses to publish without them, docs/JARVIS-SECURITY.md).

## Recovery checklist
1. `cat CLAUDE.md docs/mission/CONTINUE.md docs/mission/state.json`
2. `git log --oneline -20`
3. Latest CI run for the branch (GitHub MCP `actions_list`), failed logs only.
4. Newest `reports/acceptance-*.md`, if any, before the backlog.
