# Mission state

Phase: all milestones done. M0 (8a61178), M1 (1d9b49a), M2 (ddc05e3), M3 (a01422e), M4 on fixtures (301098a), M5 (588e0a2), M6 (ae1cc71), M7 (3e79678), M8 (25b1173), M9 (13ebcbd), M10 (4599b20); continuation 6c8f803..67efac2 (voice switch, browser choice, skills list, second review, desktop CI flake). Real hardware items are NEEDS_HARDWARE. Machine-readable status: `state.json`.

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
| M7 | Linux adapters | done (Xvfb in CI; Wayland portal needs_hardware) |
| M8 | BrowserBridge | done (Chromium extension; Firefox needs_hardware) |
| M9 | Windows and Android adapters | done (contract tests, APK builds; devices needs_hardware) |
| M10 | Vision, Skill Compiler, visibility, docs, final review | done (no real vision model wired) |

## Gates at last measurement (commit 67efac2)

- tsc -b, eslint, npm run build (web + electron/gen/runtime.cjs), scan:secrets: pass.
- vitest: 3300/3300 (363 files).
- Browser suite (npm run test:browser): 17/17 (golden 1-7 x10, golden 1-8 x10 with mock Gmail,
  conversations incl. numbered badges, ManagedBrowser hardening, voice golden, bridge extension).
- Desktop suite (npm run test:desktop, real Xvfb): 8/8.
- Acceptance: fixture x10 report reports/acceptance-2026-09-25T01-36-38-962Z.md (PARTIAL: no
  microphone, no display here).
- CI: Tests (test + browser + desktop), Ubuntu build, Android APK green on 7ad1620; see
  CONTINUE.md for the latest run.

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
src/node/acceptance/ and scripts/acceptance/run.ts. M7 added src/node/linux/ and
compositeEnvironment.ts; M8 src/node/bridge/ and extension/browser-bridge; M9
src/node/windows/uia.ts and env/android.ts (+ Java accessibility service); M10 locatorCache.ts,
env/vision.ts, skills.ts, diagnostics.ts and components/RuntimeStatusPanel.tsx. Overview:
docs/JARVIS-ARCHITECTURE.md; what works: docs/JARVIS-CAPABILITIES.md.

## Known risks

- `android/keystore/jarvis.jks` is tracked in a public repo; the key must be treated as compromised.
  Passwords removed from build.gradle in M0; rotation options in docs/JARVIS-SECURITY.md (owner).
- Store writes are coalesced (up to ~1 s of changes can be lost on a renderer crash, D-013).
- Gemini Live: the dead `gemini-2.0-flash-live-001` is replaced by the catalog default `gemini-3.8-live`, unverified against official docs from here (D-026).
- No address book yet: in the app, recipients come from the user's words or fail honestly (B-032).
