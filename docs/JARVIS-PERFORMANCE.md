# JARVIS performance

Numbers are produced by scripts in this repository, so they can be re-run and compared.
Environment for the numbers below: Claude Code cloud container, Node v22.22.2.

## Store write path

Command: `npm run perf:store -- --json` and `npm run perf:store -- --idb --json`
(`scripts/perf/store-bench.ts`). Deterministic dataset: 2.14 MB data blob (400 tasks,
300 notes, 600 memory facts with 256-dim embeddings, 500 audit entries, 300 leads, 200 sent
mails, ...), 22 subscribers (the number of components calling `useStore()` at baseline),
200 single-field mutations. Three runs per mode; the table shows the range.

### M0 baseline (commit 8a25942 code, measured during M0)

| Metric | localStorage only (no IndexedDB) | IndexedDB available |
|---|---|---|
| `setData` mean | 20.5-20.7 ms | 1.23-1.40 ms |
| `setData` p95 | 25.8-27.2 ms | 1.39-2.00 ms |
| `setData` max | 31.9-33.0 ms | 8.9-17.7 ms |
| Bytes serialized per `setData` | 2,143,941 | 369,406 |
| Storage writes per `setData` | 1 (synchronous) | 1 (synchronous) + debounced IDB flush |
| Subscribers woken per `setData` | 22 of 22 | 22 of 22 |
| 100 back-to-back `setData` | 1974-2045 ms | 112-121 ms |
| `setSettings` mean / bytes | 0.014 ms / 2,808 B | 0.014 ms / 2,808 B |
| Subscribers woken per `setSettings` | 22 of 22 | 22 of 22 |
| Module import + hydrate | 133-183 ms | 126-131 ms |

Reading: every mutation serializes the whole slim blob synchronously on the UI thread and
re-renders every `useStore()` component, whatever changed. Without IndexedDB (private mode,
some WebViews) a single toggle costs ~20 ms, more than a 60 Hz frame budget.

### Code facts at baseline

- 22 component files call `useStore()`; `useStoreSelector` exists (`src/hooks/useStore.ts`) but
  no component uses it.
- 111 `setData(` call sites in `src`.

## Bundle (vite build, M0 baseline)

- `dist` 4.1 MB, 74 assets.
- Largest chunk `index-*.js` 823 kB (305 kB gzip); `pdf-*.js` 366 kB; `Settings-*.js` 233 kB.

## M1 before/after (same script, same dataset)

"Before" = `src/lib/store.ts` from commit 8a25942 run under the M1 version of
`scripts/perf/store-bench.ts`; "after" = M1 store. Three runs per mode, ranges shown.

| Metric | Before, no IDB | After, no IDB | Before, IDB | After, IDB |
|---|---|---|---|---|
| `setData` synchronous cost, mean | 19.9-21.1 ms | 0.007-0.008 ms | 1.24-1.35 ms | 0.007 ms |
| `setData` p95 | 21.9-27.6 ms | 0.015-0.017 ms | 1.55-2.08 ms | 0.011-0.014 ms |
| Burst of 200 mutations: storage writes | 200 | 1 | 200 | 1 |
| Burst of 200 mutations: bytes serialized | 428.8 MB | 2.1 MB | 73.9 MB | 0.37 MB |
| One coalesced flush (the write the burst still pays once) | n/a | 21-23 ms | n/a | 8-16 ms |
| 40 mutations 50 ms apart: storage writes | 40 | 2 | 40 | 2 |
| 40 mutations 50 ms apart: bytes serialized | 85.8 MB | 4.3 MB | 14.8 MB | 0.74 MB |
| `setSettings` (unchanged, still synchronous) | 0.014-0.023 ms | 0.014-0.024 ms | 0.014-0.015 ms | 0.014-0.033 ms |

Persistence policy: `setData` marks the blob dirty; one write runs after 200 ms of quiet and at
most 1 s after the first unwritten change, and synchronously on `pagehide`, `beforeunload`,
`visibilitychange` to hidden, `dispose()` and `store.flush()`. In-memory state and subscribers
stay synchronous. A cross-tab `storage` event never drops unwritten local changes.
Regression tests: `tests/runtime/storePersist.test.ts`.

### Re-renders

| | Before | After |
|---|---|---|
| Always-mounted components calling `useStore()` | 1: `App` (the root, so every data mutation re-rendered the whole tree) | 0 |
| Root re-renders per data mutation that does not change what the root shows | 1 (whole tree) | 0 |
| Root re-renders when tasks-today, project name, today's value or settings change | 1 | 1 |

Measured with React in jsdom (`tests/runtime/rootRenders.test.ts`): 100 unrelated data
mutations re-render a `useStore()` consumer 100 times and the selector-based root 0 times; a
change the root renders re-renders it once. The other 21 `useStore()` components are screens
mounted only while open. Components that read `store.data` during render without subscribing
and used to rely on the root re-render (`Conversation` start screen, `More`, `BossMode`) now
subscribe themselves, only while mounted.

## Voice latency (M5)

The voice session records per-utterance timestamps (`src/lib/runtime/voice/latency.ts`):
speech start, first partial, final, intent routed, TTS cancel, first action, first verified
action, first reply text and first audio. These numbers are runtime and browser latencies with
a scripted recognizer and a fake TTS; microphone, network recognizers and real audio output are
measured by the local acceptance run (M6, NEEDS_HARDWARE here).

| Delta (ms) | In-memory fixture p50 / p95 | Chromium + YouTube fixture p50 / p95 |
|---|---|---|
| final to intent routed | 1 / 2 | 0 / 1 |
| final to first action started | 1 / 23 | 1 / 33 |
| final to action confirmed by read-back | 2 / 25 | 73 / 402 |
| final to first reply (and first audio, fake TTS) | 2 / 16 | 87 / 410 |

Sources: `tests/runtime/voiceSession.test.ts` (golden 1-8 spoken, 11 utterances) and
`tests/browser/voiceGolden.test.ts` (golden 1-8 on Chromium, 10 utterances). Barge-in cancels
speech in the same tick as the interrupting partial (`voiceSession.test.ts`, barge-in case).
A slow action gets "Sekunda." from the pre-rendered clip cache after 1.2 s of silence.
