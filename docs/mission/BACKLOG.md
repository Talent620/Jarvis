# Backlog

Status: todo, in_progress, done, blocked, needs_hardware. Nothing is done without evidence.

| ID | Title | Impact | Status | Files | Risk | Validation | Blockers |
|---|---|---|---|---|---|---|---|
| B-001 | Fix 2 red license tests with injected test key pair | M0 gate green | done | tests/license.test.ts, src/lib/license.ts | weakening verification by accident | vitest license suite + full suite | none |
| B-002 | History content scan for private keys (license, keystore) | security | done | git history, scripts/secret-scan.mjs | false negatives | scan output recorded in JARVIS-SECURITY.md | none |
| B-003 | Remove hardcoded keystore passwords; unsigned or debug-signed non-production artifact without secrets | security | done | android/app/build.gradle, .github/workflows/android*.yml | breaking release builds | gradle config review, CI android job | Android SDK not in cloud |
| B-004 | docs/JARVIS-SECURITY.md: keystore compromise, apksigner --lineage options | security | done | docs/JARVIS-SECURITY.md | none | review | none |
| B-005 | Startup performance baseline (store write cost, render fan-out, bundle) | M1 input | done | scripts/, docs/JARVIS-PERFORMANCE.md | noisy numbers | repeatable bench script | none |
| B-006 | Runtime Kernel: typed events, ids, dedup, reducer, single writer | core | done | src/lib/runtime/ | scope creep | unit tests | none |
| B-007 | Append-only task journal outside store blob (Dexie) | core | done | src/lib/runtime/journal.ts | IndexedDB in tests | fake-indexeddb tests | none |
| B-008 | Cancellation: AbortController per task in agentRun | core | done | src/lib/agentRun.ts | regressions in agentRun tests | existing + new tests | none |
| B-009 | Referent Registry with epochs, collections with cursor, typed pronoun resolution | core | done | src/lib/runtime/referents.ts | ambiguity rules | 40+ Polish resolution tests | none |
| B-010 | Situation Snapshot (<= ~300 tokens) | core | done | src/lib/runtime/snapshot.ts | token overrun | size tests | none |
| B-011 | Capability registry + diagnostic matrix | core | done | src/lib/runtime/capabilities.ts | none | unit tests | none |
| B-012 | Store: selectors in hottest components, batched deferred persistence | perf | done | src/lib/store.ts, src/hooks/useStore.ts, components | lost writes on close | store tests + before/after numbers | none |
| B-013 | Permission classes READ..DESTRUCTIVE with AUTO/ASK/DENY, extending permissions.ts | safety | todo | src/lib/permissions.ts | behaviour change for existing tools | permission tests | none |
| B-014 | Grapheme and letter semantics for Polish text | correctness | done | src/lib/runtime/text.ts | Intl.Segmenter availability | mandatory cases from 5.10 | none |
| B-015 | ManagedBrowser (Playwright persistent context, ariaSnapshot, readback) | M2 | todo | src/lib/env/managedBrowser.ts | Playwright version features | fixture tests | browser download (D-001) |
| B-016 | YouTube fixture server with consent, lazy comments, injection comment | M2 | todo | tests/fixtures/youtube/ | flakiness | 10 consecutive green runs | none |
| B-017 | Reflex grammar (Polish, tiers 0-2) | M3 | todo | src/lib/runtime/reflex.ts | partial misfires | grammar tests | none |
| B-018 | Lanes + task/focus stacks + intent routing | M3 | todo | src/lib/runtime/lanes/ | races | 12+ golden conversations | none |
| B-019 | Mail send exactly once with Sent read-back, idempotency keys | M4 | todo | src/lib/runtime/effects.ts | duplicate sends | timeout and duplicate tests | none |
| B-020 | Contacts with Polish inflection and runtime disambiguation | M4 | todo | src/lib/runtime/contacts.ts | wrong recipient | inflection tests | none |
| B-021 | Provenance tags and trust boundary for untrusted content | M4 | todo | src/lib/runtime/provenance.ts | injection bypass | injection tests | none |
| B-022 | Streaming voice interfaces, barge-in, provider catalog | M5 | todo | src/lib/voice/ | none | state machine tests | real mic = needs_hardware |
| B-023 | npm run jarvis:acceptance | M6 | todo | scripts/acceptance/ | accidental real send | --send guard tests | real desktop = needs_hardware |
| B-024 | Linux AT-SPI, portal/libei, clipboard adapters | M7 | todo | electron/, src/lib/env/linux/ | none | contract tests | needs_hardware for real session |
| B-025 | BrowserBridge extension + loopback protocol | M8 | todo | extension/, electron/ | token leakage | protocol tests | none |
| B-026 | Windows UIA and Android node-tree adapters | M9 | todo | electron/, android/ | breaking platforms | contract tests | needs_hardware |
| B-027 | Vision env, locator cache, Skill Compiler, status panel | M10 | todo | src/lib/env/vision.ts, src/lib/runtime/skills.ts | learning destructive actions | unit tests | none |
| B-028 | CI: concurrency groups, lint + typecheck + browser-on-fixtures jobs | CI | todo | .github/workflows/test.yml | CI minutes | green run | none |
