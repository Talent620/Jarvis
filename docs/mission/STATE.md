# Mission state

Phase: bootstrap done, waiting for `/goal`. Machine-readable status: `state.json`.

## Milestones

| ID | Title | Status |
|---|---|---|
| M0 | Baseline and security (license tests, keystore, private key check, perf baseline) | in_progress (baseline measured) |
| M1 | Runtime Kernel + store performance | todo |
| M2 | Managed browser + YouTube fixture, steps 1-7 | todo |
| M3 | Four lanes, task/focus stacks, 12+ interleaved golden conversations | todo |
| M4 | Mail, external effects exactly once, provenance, contacts | todo |
| M5 | Streaming voice runtime | todo |
| M6 | Local acceptance command | todo |
| M7 | Linux adapters | todo |
| M8 | BrowserBridge | todo |
| M9 | Windows and Android adapters | todo |
| M10 | Vision, Skill Compiler, visibility, docs, final review | todo |

## Gates at last measurement (commit 8a25942, see BASELINE.md)

- tsc -b: pass. eslint: pass. vite build: pass. scan:secrets: pass.
- vitest: 2787/2789, 2 pre-existing failures in `tests/license.test.ts`.

## Known risks

- `android/keystore/jarvis.jks` is tracked in a public repo and `android/app/build.gradle` falls
  back to literal passwords. Treat the signing key as compromised (M0).
- Store persists the whole blob synchronously on every `setData` and wakes all subscribers;
  no component uses `useStoreSelector` yet (M1).
- No cancellation in agentRun; AbortSignal only in `http.ts` and `ollamaPull.ts` (M1/M3).
- Gemini Live model id `gemini-2.0-flash-live-001` is dead (M5).
