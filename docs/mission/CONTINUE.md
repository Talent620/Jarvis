# CONTINUE

- GAŁĄŹ SESJI: `claude/intelligent-brahmagupta-jq7jqj`
  (local test: `git fetch origin claude/intelligent-brahmagupta-jq7jqj && git checkout claude/intelligent-brahmagupta-jq7jqj`)
- PR: https://github.com/Talent620/Jarvis/pull/7 (draft). The continuation round works on the
  same branch, so #7 stays the mission PR (D-033).
- OSTATNI ZIELONY COMMIT: `67efac2` with all local gates exit 0 (vitest, tsc, eslint, build,
  scan:secrets, browser, desktop). CI fully green on `7ad1620` (Tests with test, browser,
  desktop; Android APK; Ubuntu build). Check the latest run of the branch for `67efac2`.
- BIEŻĄCY KAMIEŃ: M13 (software factory). M0-M12 done (state.json). Mission extended with
  M11-M13 (MISSION.md section 11): JARVIS as the operator of coding agents.
- STAN TESTÓW (after 67efac2): vitest 3300/3300 (363 files); browser 17/17; desktop on Xvfb 8/8;
  golden 1-8 on the fixture 10 consecutive green runs (1.5-1.7 s each). Acceptance fixture x10:
  reports/acceptance-2026-09-25T01-36-38-962Z.md.
- OSTATNIA ZWERYFIKOWANA FUNKCJA: second review fixes (D-035): the browser switch is a step of the
  command's own task, only instructions choose a browser, the switch needs the chosen browser to
  answer, skills replay in their browser, voice control shows preemption and recognizer failures.
- DOKŁADNA NASTĘPNA AKCJA: M13: roles (planner, coder, tester, reviewer, debugger) through
  agentRun, cost router (SIMPLE..CODE_CRITICAL, TANIO/NORMALNIE/MAKSIMUM), reviewer loop,
  `npm run jarvis:coder:acceptance` (fake, local, codex), then the final adversarial review of
  M11-M13. On the user machine after that: `npm run jarvis:coder:acceptance -- --mode=codex`, and
  `npm run jarvis:acceptance -- --mode=local-desktop` / `--mode=managed-browser` for M6.
  Read the newest reports/acceptance-*.md before the backlog. Cloud work left: B-038.
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
