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

## D-009 "Pierwsze cztery litery" is a contiguous span
Letters are graphemes whose base code point is `\p{L}`. The span runs from the first letter to
the n-th letter; leading non-letters ("@", emoji, spaces) are excluded, non-letters between
letters stay inside because a visible DOM selection is contiguous ("Ala ma kota" -> "Ala m").
The golden fixture's first comment starts with a word of at least four letters.

## D-010 Duplicate STT finals
Two SpeechFinal events are one utterance when they share an utteranceId, or when their
normalized text is equal and they arrive within 1.5 s. A user repeating a command after
1.5 s is treated as a new command; idempotency keys still protect external effects.

## D-011 Collection choice without a noun
"następny", "trzeciego" without a noun go to the collection the user last navigated; if none
was navigated yet, to the most salient one (the main comments list, not nested replies).

## D-012 Stale beats fallback
When the freshest referent compatible with a phrase was invalidated (navigation, DOM change),
resolution returns "stale" instead of silently using an older valid referent. JARVIS then
says what expired and re-observes, instead of acting on the wrong thing.

## D-013 Coalesced store persistence
`setData` no longer serializes the blob synchronously. Window: 200 ms debounce, 1 s max wait,
synchronous flush on pagehide / beforeunload / hidden / dispose / `store.flush()`. Risk: a
renderer crash can lose up to ~1 s of changes; accepted because every normal close path
flushes and the synchronous cost dropped from ~20 ms to ~0.01 ms per mutation. The separate
IndexedDB debounce was removed because persistence is already coalesced.

## D-014 No /u or \p{} regex literals in src (S9 contract)
`tests/s9RegexGuard.test.ts` forbids them (old Chrome 79 WebView). Unicode classes live in
`src/lib/runtime/unicode.ts`: `new RegExp("\\p{L}", "u")` inside try/catch with explicit
range fallbacks, so an old engine degrades instead of failing to parse the bundle.

## D-015 Playwright 1.63.0 pinned; Chrome for Testing when the CDN is blocked
1.63 exposes `locator.ariaSnapshot({ mode: "ai", boxes, signal })` with `[ref=eN]` references
and `aria-ref=` locators (1.56 only had a private `_snapshotForAI`). `playwright-core` is a
runtime dependency (Electron main process drives the managed browser), `playwright` a dev
dependency (CLI for `npx playwright install`). In this cloud the Playwright CDN is blocked by
the egress policy, so `scripts/cloud-setup.sh` fetches the same Chromium build as Chrome for
Testing 153.0.8010.12 from storage.googleapis.com and exports JARVIS_CHROMIUM_PATH.

## D-016 EU consent wall: reject non-essential cookies by default
"Wejdź na YouTube" on a consent wall clicks "Odrzuć wszystko" and says so. Privacy first; the
option `consentChoice: "accept"` exists for users who prefer it.

## D-017 Environments return raw facts, the runtime judges
`ComputerEnvironment.act` never decides success. `postconditions.verify` checks each action's
end condition on a read-back through `horizon/truthLadder.climbLadder`, so every environment
(browser, AT-SPI, UIA, Android, fixtures) is judged by the same rules.

## D-018 Element identity survives re-renders by semantic key
Environment refs (`data-jarvis-ref`) are lost when a framework re-renders a list; the target
is found again by its semantic key (`comment:<id>`, `video:<href>`, or a hash of author+text on
the real site). A re-render with the same item order is a minor DOM change and does not
invalidate references; a different order or removed items is a major change. After a re-read
the collection cursor is restored to the same semantic item.

## D-019 Browser tests are a separate suite
`tests/browser/**` needs Chromium; it runs via `npm run test:browser` locally and in the CI
`browser` job (which installs Chromium), and is excluded from the default `npm test`.
