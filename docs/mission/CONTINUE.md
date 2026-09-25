# CONTINUE

- GAŁĄŹ SESJI: `claude/intelligent-brahmagupta-jq7jqj`
  (local test: `git fetch origin claude/intelligent-brahmagupta-jq7jqj && git checkout claude/intelligent-brahmagupta-jq7jqj`)
- PR: https://github.com/Talent620/Jarvis/pull/7 (draft)
- OSTATNI ZIELONY COMMIT: `588e0a2` in CI (M5); `ae1cc71` (M6) and `b5a026a` (published
  acceptance report) green locally, CI pending at the time of writing.
- BIEŻĄCY KAMIEŃ: M7 (Linux adapters). M0-M6 done (M4 on fixtures, M5/M6 real hardware items
  NEEDS_HARDWARE).
- STAN TESTÓW: vitest 3204/3204 (353 files); browser suite 15/15; acceptance fixture mode
  reports/acceptance-2026-09-25T00-01-55-607Z.md.
- OSTATNIA ZWERYFIKOWANA FUNKCJA: `npm run jarvis:acceptance -- --runs=10`: golden 1-7 x10 and
  full 1-8 confirmed on Chromium, report committed and pushed alone (b5a026a).
- DOKŁADNA NASTĘPNA AKCJA: M7. Linux ComputerEnvironment adapters behind the same contract:
  AT-SPI (accessibility tree via a python3/gi bridge or D-Bus), input through the RemoteDesktop
  portal / libei with ydotool/xdotool fallback, system clipboard (wl-clipboard/xclip), active
  window, primary selection, basic window list. Contract tests with injected command runners;
  anything needing a real session is NEEDS_HARDWARE. Then M8 BrowserBridge, M9 Windows/Android,
  M10 vision, Skill Compiler, status panel, docs, final review, final report.
- LOCAL RUN: `npm ci && npm run test:browser && npm run jarvis:acceptance`.
- POZYCJE NEEDS_HARDWARE: B-030 real YouTube selectors, B-031 real Gmail send + Sent read-back,
  B-032 address book source, B-033 voice on a real microphone. Run on the user machine:
  `npm run jarvis:acceptance -- --mode=managed-browser` and `--mode=local-desktop`.
- POZYCJE BLOCKED: none (YouTube is blocked only from the cloud session by network policy).
- OWNER ACTION: set `JARVIS_RELEASE_STORE_PASSWORD` / `JARVIS_RELEASE_KEY_PASSWORD` secrets before
  the next release (release.yml refuses to publish without them, docs/JARVIS-SECURITY.md).

## Recovery checklist
1. `cat CLAUDE.md docs/mission/CONTINUE.md docs/mission/state.json`
2. `git log --oneline -20`
3. Latest CI run for the branch (GitHub MCP `actions_list`), failed logs only.
4. Newest `reports/acceptance-*.md`, if any, before the backlog.
