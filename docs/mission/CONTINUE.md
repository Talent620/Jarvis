# CONTINUE

- GAŁĄŹ SESJI: `claude/intelligent-brahmagupta-jq7jqj`
  (local test: `git fetch origin claude/intelligent-brahmagupta-jq7jqj && git checkout claude/intelligent-brahmagupta-jq7jqj`)
- PR: https://github.com/Talent620/Jarvis/pull/7 (draft). The continuation round works on the
  same branch, so #7 stays the mission PR (D-033).
- OSTATNI ZIELONY COMMIT: the review-fix commit after `422856c` (see `git log -1`), all local
  gates exit 0 (vitest 3379, desktop 8/8, tsc, eslint, build, scan:secrets, coder acceptance fake).
  CI green on `422856c` (Tests, Ubuntu build, Android APK).
- BIEŻĄCY KAMIEŃ: none open. M0-M13 done (state.json), M11-M13 reviewed and fixed (D-039).
- STAN TESTÓW: vitest 3379/3379 (371 files, 145 of them in tests/coder); browser 17/17; desktop
  8/8; golden 1-8 on the fixture 10 runs green; `npm run jarvis:coder:acceptance` fake 5/5.
- OSTATNIA ZWERYFIKOWANA FUNKCJA: JARVIS as the operator of coding agents (M11-M13): Codex /
  Claude Code / local model, kernel task, live control by voice, software factory, review fixes.
- DOKŁADNA NASTĘPNA AKCJA: on the user machine with Codex installed and logged in:
  `npm ci && npm run jarvis:coder:acceptance -- --mode=codex` (a throwaway project in the temp
  folder). Then add a real project in KOD and say "napraw testy w projekcie X". For M6:
  `npm run jarvis:acceptance -- --mode=local-desktop` / `--mode=managed-browser`. Read the
  newest reports/coder-acceptance-*.md and reports/acceptance-*.md before the backlog. Cloud
  work left: B-038.
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
