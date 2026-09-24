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

## After (M1)

To be filled by M1 with the same commands.
