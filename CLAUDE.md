# JARVIS: mission "FILMOWY"

Goal: a voice-driven JARVIS that runs the golden scenario (open browser, YouTube, scroll,
find comments, first comment, select first four letters, copy, email it to Marcin) with
normal conversation interleaved, every step confirmed by read-back, one consent at the send
boundary, same runtime on fixtures and in production. Full spec: `docs/mission/MISSION.md`.

## Read first (recover context in 2 minutes)
1. `docs/mission/CONTINUE.md` (branch, last green commit, exact next action)
2. `docs/mission/state.json` (milestones M0-M10, evidence, next_action)
3. `docs/mission/STATE.md`, `docs/mission/BACKLOG.md`, `docs/mission/DECISIONS.md`
4. `git log --oneline -20` and latest CI run
5. `reports/acceptance-*.md` from real hardware beats the backlog

## Commands
- Install: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` (cloud: `scripts/cloud-setup.sh` runs it)
- Typecheck: `npx tsc -b` | Lint: `npx eslint .` | Build: `npm run build`
- Unit tests: `npx vitest run` (one file: `npx vitest run tests/<name>.test.ts`)
- Secret scan: `npm run scan:secrets` | Full gate: `npm run quality`
- Browser tests: Chromium from `JARVIS_CHROMIUM_PATH` or `/opt/pw-browsers/chromium`

## Rules (mission section 0)
- Implement, do not recommend. Audit only when it feeds implementation right away.
- Verify, do not declare. Evidence is an observable end condition, never an "ok" from a command.
- Never fake success. States: SIMULATED, ATTEMPTED, CONFIRMED, UNKNOWN_AFTER_ATTEMPT, FAILED,
  BLOCKED, NEEDS_PERMISSION, NEEDS_HARDWARE. CONFIRMED only after matching read-back.
- Extend agentRun, truthLadder, permissions, missionUndo, goalResume, tool registry. No rewrites for style.
- Do not ask, do not wait. Pick the safest option, log it in `docs/mission/DECISIONS.md`, continue.
  (The product itself must ask the user for consent where policy says so.)
- Zero paid API calls in tests: fixtures, mocks, recorded event streams, contract tests.
- Checkpoint after every green increment: test, commit, push, update mission state.

## Platform and repo rules (mission section 3)
- Work and push only on the session branch (`claude/*`). Never force push, reset --hard others'
  work, rewrite history, push or merge to main, publish or overwrite releases.
- One draft PR after M0, description updated per milestone; fallback `docs/mission/PR.md`.
- Electron in cloud: `ELECTRON_SKIP_BINARY_DOWNLOAD=1`. Main-process logic lives in pure Node
  modules with a thin IPC adapter. Packages are built by GitHub Actions.
- No hardware here (mic, desktop, Ollama, real Gmail, contacts, Codex login): adapter + tests +
  local acceptance, status NEEDS_HARDWARE, move on.
- CI deterministic: secret scan, lint, typecheck, unit, golden runtime, browser-on-fixtures, build.
  Concurrency groups with cancel-in-progress. No scheduled workflows calling AI models.
  Do not change release workflows except to fix bugs.
- Zero secrets in repo, logs, commits. Never print env var values.
- Never use the em dash (U+2014) anywhere. Code, comments, technical docs in English.
  Final report and PR summary in Polish, short.
- Out of scope unless they break build/tests: Sales OS, Site OS, leads, campaigns, finance,
  `kompas/`, `sales-os/`, `demo-przempol/`.

## Subagents (`.claude/agents/`)
explorer (haiku, read-only search), implementer (sonnet, exact-spec mechanical edits),
reviewer (adversarial read-only diff review). Always review and test subagent output yourself.
