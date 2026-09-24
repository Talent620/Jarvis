# Mission state

Phase: M0 done (8a61178), M1 done (1d9b49a), M2 done (ddc05e3), M3 in progress. Machine-readable status: `state.json`.

## Milestones

| ID | Title | Status |
|---|---|---|
| M0 | Baseline and security (license tests, keystore, private key check, perf baseline) | done |
| M1 | Runtime Kernel + store performance | done |
| M2 | Managed browser + YouTube fixture, steps 1-7 | done |
| M3 | Four lanes, task/focus stacks, 12+ interleaved golden conversations | in_progress |
| M4 | Mail, external effects exactly once, provenance, contacts | todo |
| M5 | Streaming voice runtime | todo |
| M6 | Local acceptance command | todo |
| M7 | Linux adapters | todo |
| M8 | BrowserBridge | todo |
| M9 | Windows and Android adapters | todo |
| M10 | Vision, Skill Compiler, visibility, docs, final review | todo |

## Gates at last measurement (commit 6e8f018)

- tsc -b, eslint, npm run build (web + electron/gen/runtime.cjs), scan:secrets: pass.
- vitest: 2968/2968 (339 files) before M3 part 1; runtime suite 178/178 after it.
- Browser suite (npm run test:browser): golden steps 1-7, 10 consecutive green runs, IPC path,
  150 ms re-render stress; green locally and in the CI `browser` job.
- CI: Tests, browser, Ubuntu build, Android APK green on the branch.

## Runtime (src/lib/runtime) after M1

kernel.ts (single writer, dedup, AbortController per task, journal), reducer.ts, events.ts,
journal.ts (Dexie, own DB), referents.ts + resolve.ts + polish.ts (Polish reference
resolution), text.ts + unicode.ts (graphemes/letters, S9-safe), snapshot.ts (<= 300 tokens),
capabilities.ts (requirements, probes, matrix), truth.ts, provenance.ts, util.ts.
M2 added: env/types.ts (ComputerEnvironment), env/ipc.ts, postconditions.ts, actions.ts,
commands.ts, session.ts, appRuntime.ts; src/node/managedBrowser.ts (+ envHost, electronRuntime,
browserExecutable). Desktop app routes computer-control commands from the chat to the runtime.

## Known risks

- `android/keystore/jarvis.jks` is tracked in a public repo; the key must be treated as compromised.
  Passwords removed from build.gradle in M0; rotation options in docs/JARVIS-SECURITY.md (owner).
- Store writes are coalesced (up to ~1 s of changes can be lost on a renderer crash, D-013).
- Gemini Live model id `gemini-2.0-flash-live-001` is dead (M5).
