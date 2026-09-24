# Mission state

Phase: M0 done (8a61178), M1 done (1d9b49a), M2 in progress. Machine-readable status: `state.json`.

## Milestones

| ID | Title | Status |
|---|---|---|
| M0 | Baseline and security (license tests, keystore, private key check, perf baseline) | done |
| M1 | Runtime Kernel + store performance | done |
| M2 | Managed browser + YouTube fixture, steps 1-7 | in_progress |
| M3 | Four lanes, task/focus stacks, 12+ interleaved golden conversations | todo |
| M4 | Mail, external effects exactly once, provenance, contacts | todo |
| M5 | Streaming voice runtime | todo |
| M6 | Local acceptance command | todo |
| M7 | Linux adapters | todo |
| M8 | BrowserBridge | todo |
| M9 | Windows and Android adapters | todo |
| M10 | Vision, Skill Compiler, visibility, docs, final review | todo |

## Gates at last measurement (commit 1d9b49a)

- tsc -b: pass. eslint: pass. vite build: pass. scan:secrets: pass.
- vitest: 2921/2921 (335 files).
- CI: Tests green on 8a61178; Android workflows fixed in e192be6 (setup-android packages).

## Runtime (src/lib/runtime) after M1

kernel.ts (single writer, dedup, AbortController per task, journal), reducer.ts, events.ts,
journal.ts (Dexie, own DB), referents.ts + resolve.ts + polish.ts (Polish reference
resolution), text.ts + unicode.ts (graphemes/letters, S9-safe), snapshot.ts (<= 300 tokens),
capabilities.ts (requirements, probes, matrix), truth.ts, provenance.ts, util.ts.
Not yet wired into the chat/voice UI (M3) or a status panel (M10).

## Known risks

- `android/keystore/jarvis.jks` is tracked in a public repo; the key must be treated as compromised.
  Passwords removed from build.gradle in M0; rotation options in docs/JARVIS-SECURITY.md (owner).
- Store writes are coalesced (up to ~1 s of changes can be lost on a renderer crash, D-013).
- Gemini Live model id `gemini-2.0-flash-live-001` is dead (M5).
