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

## D-010 Duplicate STT finals (superseded by D-021)
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

## D-020 "poprzedni" returns to the adjacent item, "następny" skips rejected ones
After "nie ten, następny" the user saying "poprzedni" has changed their mind; going back to
the rejected item is what they asked for. Forward navigation still skips rejected items.

## D-021 Text-window dedup of finals only for STT, 800 ms
A 1.5 s window swallowed intended repeats ("dalej", "dalej"; "cofnij", "cofnij") and typed
input. Now: same utteranceId is always a duplicate; the same normalized text is a duplicate
only for STT finals within 800 ms. Typed input is never merged by text. External effects are
still protected by idempotency keys.

## D-022 Scroll and open are never retried; scroll is programmatic
A second attempt of a scroll or an open repeats the effect (scrolls twice, opens another item)
instead of retrying it, so both run once and report the read-back honestly. The managed
browser scrolls with an instant `scrollTo` in the isolated world after the page's `load`
event: a synthetic wheel right after a navigation was dropped before the first frame on a fast
CI runner (read-back showed no movement), and a late wheel could land twice. Lazy lists still
load because IntersectionObserver sees any scroll.

## D-023 "blocked" ends a task; consent needs a clear yes to the question asked
A missing precondition or a refusal is final for that task, so nothing can wait on it forever.
Waiting for the user ("który Marcin?", consent) is `waiting_consent`; a pause remembers it and
"wznów" returns there. A consent is granted only by tak / tak, wyślij / wyślij / potwierdzam /
zgoda, and only for the consent whose question the user heard; "ok", "dobra", "jasne" get a
request for a clear answer. A consent granted while paused waits for "wznów" before sending.

## D-024 External effects are recorded as attempted before they happen
The journal gets ActionAttempted before the provider call, so a crash mid-send restores as
UNKNOWN_AFTER_ATTEMPT. A thrown provider error is "maybe sent" (Sent is read before any retry);
only an explicit rejection on the first attempt is a clean FAILED.

## D-025 After outside content, known external effects always get a fresh question
Output of web research, mail reads and MCP/plugin tools marks the context untrusted for 10
minutes. During that time a classified outbound tool (gmail_send, send_sms, make_call, ...)
ignores remembered consent, auto-consent and session scope and asks once, fail-closed without a
UI. Unclassified plugin/MCP tools are already consent-gated per tool and keep their remembered
consent: forcing a prompt on each of their calls made multi-step plugins unusable. Summaries of
screen text go through an isolated model call (fixed system prompt, quoted data, no tools, no
history) and stay untrusted.

## D-026 Voice: catalog ids, echo and barge-in rules
Model ids live in `src/lib/runtime/voice/catalog.ts` with their source and a verified flag. The
default Live model `gemini-3.8-live` (NON_BLOCKING function calling) comes from the mission
brief: the official docs were unreachable from the build session (network policy, 403), so it is
marked unverified; the dead `gemini-2.0-flash-live-001` maps to it. Echo: text heard while or
right after JARVIS speaks is compared with everything it just said as one bag of words; a single
word in a growing partial is held back if JARVIS just said it, a single-word final only if JARVIS
said exactly that word, so a short "tak", "nie" or "stop" from the user always gets through.
Barge-in: a non-echo user partial (stability >= 0.5, not a backchannel like "mhm") or final
stops speech at once. Deepgram authenticates with the documented browser subprotocol; OpenAI
Realtime needs an ephemeral token from a backend, so the app chain is Deepgram (when a key
exists) then Whisper.

## D-027 Linux adapters: command-line tools and an AT-SPI helper, portal reported not faked
The Linux desktop environment (`src/node/linux/`) drives wl-clipboard or xclip/xsel, xdotool and
wmctrl (X11), swaymsg or hyprctl (Wayland), ydotool, and AT-SPI through a small Python helper on
gi Atspi 2.0, always as argv arrays with timeouts. GNOME and KDE on Wayland expose no active
window without a shell extension: reported missing, not guessed. Wayland input through the
RemoteDesktop portal needs the user's consent and a libei helper: reported NEEDS_PERMISSION
until that helper exists; ydotool is "degraded" (needs ydotoold and /dev/uinput). A desktop key
combo without a declared read-back ends ATTEMPTED, never CONFIRMED or FAILED. On X11 the
clipboard belongs to the app that copied: without a clipboard manager it is gone when that app
exits, so acceptance proves the system clipboard during the run, not afterwards. Real tests run
on a throwaway Xvfb session with openbox, the AT-SPI bus and a GTK app (`npm run test:desktop`,
CI job `desktop`).

## D-028 BrowserBridge: loopback WebSocket, pairing code then token, managed browser stays default
The extension talks to a loopback-only WebSocket (`ws`, bundled into the Electron runtime) that
accepts only extension origins; pairing uses a 6-digit one-time code, then a random token stored
by JARVIS as a hash. The bridge observes the user's current tab and runs four commands. It does
not replace the managed browser: the golden scenario and the action lane keep the managed
browser, and the bridge is `browser.bridge` for tasks aimed at the user's own browser (routing
those utterances is backlog B-035). Without a connected extension bridge commands are
NEEDS_CAPABILITY. Firefox shares the MV3 manifest (`background.scripts`) but is only exercised
through the protocol tests here.

## D-029 Windows and Android: semantic primitives through the platform accessibility APIs
Windows uses UI Automation through a PowerShell helper (focused element, TextPattern selection,
windows, clipboard, SendKeys); parameters are base64 JSON inside `-EncodedCommand`, so user text is
never code. Android extends the existing JARVIS accessibility service with the focused node,
ACTION_SET_SELECTION, ACTION_COPY, append, scroll, windows and a bounded node tree, exposed through
the SystemActions plugin. Android lets only the foreground app read the clipboard, so a copy made
in another app ends ATTEMPTED with that reason; in general an action whose read-back cannot be
read at all is ATTEMPTED (unverifiable), not FAILED. Both run behind the same ComputerEnvironment
contract; real runs need the devices (NEEDS_HARDWARE here), the APK build compiles the Java side.

## D-030 Vision is a last resort, confirmed by the same read-back; skills replay intents
`EscalatingEnvironment` wraps the semantic environment: semantic first, then a verified cached
locator, then a vision model on a screenshot, then the honest not found. Only pointer targets
(open, focus) escalate; selection and copy stay semantic, because a pixel drag cannot be verified
as precisely. The model's box is untrusted: used only with confidence >= 0.6 and fully inside the
image, and a click is cached only after the runtime's own postcondition confirms it. Vision
locators die on the first failure or a changed layout signature. No vision model is wired in the
app yet (the capability reads `missing`); tests use a fake model and a fake pointer.
The Skill Compiler remembers the confirmed tail of the last commands (at most 12, broken by any
unconfirmed step or a pause over 15 minutes) as Polish utterances, not coordinates: replay sends
each one through the action lane again, so every step is resolved and verified anew. A real
failure disables the skill; a missing precondition or "stop" does not. A send step is handed over
and the replay ends there: the consent question is the user's, a skill never answers it. Skills
live in local storage (`jarvis.skills.v1`); malformed entries are ignored.
