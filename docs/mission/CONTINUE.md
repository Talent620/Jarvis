# CONTINUE

- GAŁĄŹ SESJI: `claude/intelligent-brahmagupta-jq7jqj`
  (local test: `git fetch origin claude/intelligent-brahmagupta-jq7jqj && git checkout claude/intelligent-brahmagupta-jq7jqj`)
- PR: https://github.com/Talent620/Jarvis/pull/7 (draft)
- OSTATNI ZIELONY COMMIT: `8a61178` (M0; vitest 2799/2799, tsc, eslint, build, secret scan green;
  CI Tests green on push and PR)
- BIEŻĄCY KAMIEŃ: M1 (Runtime Kernel + store performance)
- STAN TESTÓW: vitest 328 files / 2799 tests, exit 0.
- STAN CI: Tests green. Build Android APK red since September on `android-actions/setup-android@v3`
  ("Failed to find package 'tools'", runner image change, also red on the bootstrap commit that
  did not touch Android). Fixed by `packages: "platform-tools"` in android*.yml and release.yml.
- OSTATNIA ZWERYFIKOWANA FUNKCJA: M0 license verification with injected key pair; Android
  signing without hardcoded passwords (tests/androidSigning.test.ts).
- DOKŁADNA NASTĘPNA AKCJA: M1 step 1. Create `src/lib/runtime/` with typed kernel events,
  event ids + dedup, single-writer reducer, task state with AbortController, append-only task
  journal (Dexie, outside the store blob). Tests first in `tests/runtime/`.
- POZYCJE NEEDS_HARDWARE: none recorded yet.
- POZYCJE BLOCKED: none.
- OWNER ACTION: set `JARVIS_RELEASE_STORE_PASSWORD` / `JARVIS_RELEASE_KEY_PASSWORD` secrets before
  the next release (release.yml refuses to publish without them, docs/JARVIS-SECURITY.md).

## Recovery checklist
1. `cat CLAUDE.md docs/mission/CONTINUE.md docs/mission/state.json`
2. `git log --oneline -20`
3. Latest CI run for the branch (GitHub MCP `actions_list`), failed logs only.
4. Newest `reports/acceptance-*.md`, if any, before the backlog.
