# Decisions

Developer decisions taken without asking (mission rule 5). Newest at the bottom.

## D-001 Playwright dependency is added in M2, not during bootstrap
Bootstrap only prepares the browser. The container already ships Chromium build 1194 under
`/opt/pw-browsers`. Adding `playwright` now would change `package-lock.json` before the
baseline is committed. In M2 a pinned version goes into devDependencies and tests launch with
`executablePath` from `JARVIS_CHROMIUM_PATH` (set by `scripts/cloud-setup.sh`) when the pinned
version's own browser is missing. Safer: no lockfile churn in bootstrap, no forced download.

## D-002 cloud-setup.sh never fails the session
The SessionStart hook prints warnings and exits 0 on any failure (npm ci, browser, xvfb). A
broken hook would block every session start; failures surface in the next gate run instead.

## D-003 npm ci skip key lives inside node_modules
The package-lock hash stamp is stored at `node_modules/.cache/jarvis-cloud-setup/lock.sha256`.
If `node_modules` disappears the stamp goes with it, so a stale skip is impossible.

## D-004 Browser resolution order in cloud-setup.sh
`JARVIS_CHROMIUM_PATH` if already valid, then the installed Playwright's own Chromium, then the
preinstalled `/opt/pw-browsers/chromium`, then `npx playwright install chromium` (bounded to
5 minutes), then Chrome for Testing via `@puppeteer/browsers` (bounded to 5 minutes). The
result is exported through `CLAUDE_ENV_FILE` when the harness provides it.

## D-005 state.json keeps the exact prescribed schema
Only `id`, `status`, `evidence`, `last_commit`, `next_action` per milestone. Milestone titles
live in STATE.md so tools that parse state.json never see unexpected keys.

## D-006 release.yml refuses to publish without signing secrets
With hardcoded passwords removed, a release build without secrets is debug-signed and
"-nonprod". Publishing that as `latest` would silently change the signing identity, so the
release workflow now fails in its first step when `JARVIS_RELEASE_STORE_PASSWORD` or
`JARVIS_RELEASE_KEY_PASSWORD` is missing. This is a bug fix to the release workflow (allowed by
mission section 3). CI artifact workflows (android.yml, android-v2.yml) keep building.

## D-007 License verification seam
`verifyLicenseWithKey(token, key)` holds the verification logic; `verifyLicense(token)` binds
it to the embedded `PUBLIC_JWK`. Tests generate a P-256 pair at runtime. No production call
site passes a key, and tests assert the production path rejects test-key and pre-rotation
tokens, so verification is not weakened.

## D-008 Store benchmark uses vite-node and an in-memory localStorage shim
`scripts/perf/store-bench.ts` runs the real `src/lib/store.ts` under `vite-node` with a
deterministic 2.1 MB dataset. It measures synchronous write cost, bytes serialized and
subscriber wakes; React render cost is inferred from wakes (every `useStore()` component
re-renders per wake). Same script is used for the M1 "after" numbers.
