# Baseline (bootstrap, 2026-09-24)

Measured in the Claude Code cloud container on branch `claude/intelligent-brahmagupta-jq7jqj`
at commit `8a25942`. Node v22.22.2, npm 10.9.7. CI (`.github/workflows/test.yml`) uses Node 20.

## git log --oneline -15

```
8a25942 chore(license): rotacja pary kluczy ECDSA
c0e2697 fix(linux): set deb package maintainer
538fefa Stabilize Jarvis autonomy, Site OS, AI Sales and Ubuntu
73eb6af Merge branch 'main' of https://github.com/Talent620/Jarvis into codex/site-os-image-library
5c09458 ci: add unified repository quality gate
168758f feat(mcp): add secure local stdio servers
f3db6b2 fix(security): block workspace symlink escapes
a40b721 fix(site-os): reuse an existing local instance
ffeaf8a fix: enforce workspace paths across platforms
9e7e85e test: stabilize cold tool registry import
d1d462b ci: validate Ubuntu packages on pull requests
ef1ce8d docs: record Ubuntu packaging validation
f875513 feat: add reproducible Ubuntu bootstrap
d406a8a fix(sales-os): migrate to secure Next.js 15
4f61985 fix(sales-os): update authentication security
```

## Gates

| Gate | Command | Exit | Time | Result |
|---|---|---|---|---|
| Install | `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` | 0 | 20 s | 823 packages, only deprecation warnings |
| Typecheck | `npx tsc -b` | 0 | 21 s | no errors |
| Lint | `npx eslint .` | 0 | 16 s | no errors, no warnings |
| Unit tests | `npx vitest run` | 1 | 78 s | files 326/327 passed, tests 2787/2789 passed |
| Build | `npx vite build` | 0 | 12 s | dist 4.1 MB, 74 assets, largest chunk `index-*.js` 823 kB (305 kB gzip) |
| Secret scan | `npm run scan:secrets` | 0 | <5 s | clean |

`npm run build` is `tsc -b && vite build`, so it passes too (both parts exit 0).

### Failing tests (both pre-existing)

- `tests/license.test.ts`, test `akceptuje ważny klucz właściciela i czyta dane`
- `tests/license.test.ts`, test `akceptuje ważny klucz mimo brudnego wklejenia (spacje + zero-width)`

Both fail with `expected false to be true` on `verifyLicense(MASTER).valid`. Commit `8a25942`
changed only `src/lib/license.ts` (2 lines, the embedded public key), so the committed fixture
license was signed by the old private key. Fix belongs to M0 (inject a test key pair, keep the
verification strict).

## Audit claims (section 2) spot-checked against code

| Claim | Code says |
|---|---|
| src/lib has 269 modules | 269 entries in `src/lib`, 287 `.ts` files including subdirectories |
| tools.ts has 108 tools | 108 `name:` entries in `src/lib/tools.ts` (1925 lines) |
| permissions.ts has 3 classes | `type Risk = "read" \| "write" \| "outbound"` (214 lines) |
| AbortSignal only in http.ts and ollamaPull.ts | confirmed (plus generated knowledge index) |
| liveVoice uses gemini-2.0-flash-live-001 | confirmed, `src/lib/liveVoice.ts:8` |
| 22 components use useStore(), 0 useStoreSelector | 22 files call `useStore()`; `useStoreSelector` exists in `src/hooks/useStore.ts:43` and has a test, but no component uses it |
| 110 setData calls | 111 `setData(` occurrences in `src` |
| keystore in repo, hardcoded passwords | `android/keystore/jarvis.jks` tracked; `android/app/build.gradle:37,39` fall back to literal passwords |
| JarvisAccessibilityService 91 lines | confirmed |
| electron/main.cjs | 650 lines |
| agentRun.ts | 216 lines |

Private key leak check (history, by file name): no `*private*`, `*.pem`, `*.key`, `*.p12` added in
any commit except `android/keystore/jarvis.jks`. Content-level history scan is part of M0.

## Environment notes

- Chromium for Playwright is preinstalled at `/opt/pw-browsers` (build 1194), `PLAYWRIGHT_BROWSERS_PATH`
  points there. Xvfb and xvfb-run are present. Verified: `chromium --headless=new --dump-dom`
  on a data URL printed the expected DOM.
- `scripts/cloud-setup.sh`: first run 14.4 s (npm ci), repeat run 15 ms (npm ci skipped by
  lock hash), exits 0 immediately when `CLAUDE_CODE_REMOTE` is not `true`.
- Playwright is not yet a dependency (see DECISIONS.md D-001).
