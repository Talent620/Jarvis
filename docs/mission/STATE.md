# Mission state

Phase: M0 done (8a61178), M1 done (1d9b49a), M2 done (ddc05e3), M3 done (a01422e), M4 done on fixtures (301098a), M5 done (588e0a2), M6 done (ae1cc71), M7 next. Machine-readable status: `state.json`.

## Milestones

| ID | Title | Status |
|---|---|---|
| M0 | Baseline and security (license tests, keystore, private key check, perf baseline) | done |
| M1 | Runtime Kernel + store performance | done |
| M2 | Managed browser + YouTube fixture, steps 1-7 | done |
| M3 | Four lanes, task/focus stacks, 12+ interleaved golden conversations | done |
| M4 | Mail, external effects exactly once, provenance, contacts | done (fixtures; real Gmail needs_hardware) |
| M5 | Streaming voice runtime | done (real mic needs_hardware) |
| M6 | Local acceptance command | done (real desktop runs needs_hardware) |
| M7 | Linux adapters | in_progress |
| M8 | BrowserBridge | todo |
| M9 | Windows and Android adapters | todo |
| M10 | Vision, Skill Compiler, visibility, docs, final review | todo |

## Gates at last measurement (commit ae1cc71)

- tsc -b, eslint, npm run build (web + electron/gen/runtime.cjs), scan:secrets: pass.
- vitest: 3204/3204 (353 files).
- Browser suite (npm run test:browser, 15 tests): golden 1-7 x10, golden 1-8 x10 with mock
  Gmail, variant without data-comment-id, conversations, ManagedBrowser hardening, voice-driven
  golden 1-8.
- Acceptance: `npm run jarvis:acceptance -- --runs=10` fixture mode published as
  reports/acceptance-2026-09-25T00-01-55-607Z.md (verdict PARTIAL: no microphone here).
- CI: Tests (test + browser), Ubuntu build, Android APK green on 588e0a2.

## Runtime (src/lib/runtime) after M1

kernel.ts (single writer, dedup, AbortController per task, journal), reducer.ts, events.ts,
journal.ts (Dexie, own DB), referents.ts + resolve.ts + polish.ts (Polish reference
resolution), text.ts + unicode.ts (graphemes/letters, S9-safe), snapshot.ts (<= 300 tokens),
capabilities.ts (requirements, probes, matrix), truth.ts, provenance.ts, util.ts.
M2 added: env/types.ts (ComputerEnvironment), env/ipc.ts, postconditions.ts, actions.ts,
commands.ts, session.ts, appRuntime.ts; src/node/managedBrowser.ts (+ envHost, electronRuntime,
browserExecutable). Desktop app routes computer-control commands from the chat to the runtime.
M3 added lanes/ (reflex, conversation, runtime = JarvisRuntime). M4 added contacts.ts, mail.ts
(exactly once, Sent read-back), gmailService.ts (production MailService), untrusted.ts
(isolated summaries), permission classes (permissionClasses.ts) and the untrusted-context gate
in permissions.ts. The app runs the full JarvisRuntime (appRuntime.ts).
M5 added voice/ (catalog, adapters, session, latency, browserAudio); M6 added
src/node/acceptance/ and scripts/acceptance/run.ts.

## Known risks

- `android/keystore/jarvis.jks` is tracked in a public repo; the key must be treated as compromised.
  Passwords removed from build.gradle in M0; rotation options in docs/JARVIS-SECURITY.md (owner).
- Store writes are coalesced (up to ~1 s of changes can be lost on a renderer crash, D-013).
- Gemini Live: the dead `gemini-2.0-flash-live-001` is replaced by the catalog default `gemini-3.8-live`, unverified against official docs from here (D-026).
- No address book yet: in the app, recipients come from the user's words or fail honestly (B-032).
