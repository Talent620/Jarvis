# Mission state

Phase: M0 done (8a61178), M1 in progress. Machine-readable status: `state.json`.

## Milestones

| ID | Title | Status |
|---|---|---|
| M0 | Baseline and security (license tests, keystore, private key check, perf baseline) | done |
| M1 | Runtime Kernel + store performance | in_progress |
| M2 | Managed browser + YouTube fixture, steps 1-7 | todo |
| M3 | Four lanes, task/focus stacks, 12+ interleaved golden conversations | todo |
| M4 | Mail, external effects exactly once, provenance, contacts | todo |
| M5 | Streaming voice runtime | todo |
| M6 | Local acceptance command | todo |
| M7 | Linux adapters | todo |
| M8 | BrowserBridge | todo |
| M9 | Windows and Android adapters | todo |
| M10 | Vision, Skill Compiler, visibility, docs, final review | todo |

## Gates at last measurement (commit 8a61178)

- tsc -b: pass. eslint: pass. vite build: pass. scan:secrets: pass.
- vitest: 2799/2799 (328 files).
- CI: Tests green; Android APK workflows red on setup-android (runner image), fix pushed after 8a61178.

## Known risks

- `android/keystore/jarvis.jks` is tracked in a public repo; the key must be treated as compromised.
  Passwords removed from build.gradle in M0; rotation options in docs/JARVIS-SECURITY.md (owner).
- Store persists the whole blob synchronously on every `setData` and wakes all subscribers;
  no component uses `useStoreSelector` yet (M1).
- No cancellation in agentRun; AbortSignal only in `http.ts` and `ollamaPull.ts` (M1/M3).
- Gemini Live model id `gemini-2.0-flash-live-001` is dead (M5).
