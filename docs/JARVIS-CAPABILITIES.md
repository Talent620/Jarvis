# What JARVIS can do (and how we know)

Only what works is listed. "Verified" means a test or CI run shows the observable end state
(read-back), not that a command returned ok. NEEDS_HARDWARE means the adapter and its tests exist
but the real device, account or desktop was not available where this was built; the local
acceptance run (`npm run jarvis:acceptance`) is how it gets verified on the user's machine.

## Golden scenario

| Step | Status | Evidence |
| --- | --- | --- |
| 1-7 "uruchom przeglądarkę" ... "skopiuj" on the YouTube fixture | Verified, 10 consecutive green runs | `tests/browser/golden17.test.ts`, CI job `browser` |
| 8 "wyślij to mailem Marcinowi" with one consent, confirmed from Sent (mock Gmail) | Verified | `tests/browser/golden18.test.ts`, `tests/runtime/goldenMail.test.ts` |
| The same spoken, with chatter, from recognizer event streams | Verified (recorded streams) | `tests/runtime/voiceSession.test.ts`, `tests/browser/voiceGolden.test.ts` |
| On real YouTube in the managed browser | NEEDS_HARDWARE (network policy blocks YouTube here) | `--mode=managed-browser` |
| Real Gmail send and Sent read-back | NEEDS_HARDWARE (no account here) | `gmailService.test.ts` with a fake transport; `--send` on the user machine |
| Real microphone and speakers | NEEDS_HARDWARE | `--mode=local-desktop` |

## Conversation and control

| Capability | Status | Evidence |
| --- | --- | --- |
| Stop, pause, resume, undo, "dalej" without an LLM, tier 0 on stable partials | Verified | `reflex.test.ts`, `goldenConversations.test.ts` |
| Side chat while an action runs; "co teraz robisz?" | Verified (stub model) | `goldenConversations.test.ts` |
| "nie ten, następny", "poprzedni", "wróćmy do komentarza" | Verified | `resolvePolish.test.ts` (53 cases), `goldenConversations.test.ts` |
| Duplicate recognizer finals never repeat an action | Verified | `kernel.test.ts`, `voiceSession.test.ts` |
| A partial corrected by the final: only the final runs | Verified | `goldenConversations.test.ts` G8 |
| Barge-in: "stop" silences speech in the same tick | Verified | `voiceSession.test.ts` |
| Consent asked once, strict "tak"; "ok" is not consent | Verified | `goldenMail.test.ts`, `reviewFixes.test.ts` |
| Hung tool or model given up; broken model replies never spoken or acted on | Verified | `timeoutsBrokenModels.test.ts` |
| Restart during a task: running tasks come back paused, external ones UNKNOWN | Verified | `kernel.test.ts` |
| "zapamiętaj to jako X" / "powtórz X" (skills), each step verified again | Verified | `skillsVision.test.ts` |
| "Co robię" panel with PAUZA / WZNÓW / STOP, redacted diagnostics export, skills list | Verified (render and runtime tests) | `statusDiagnostics.test.ts` |
| "Sterowanie komputerem głosem" switch (Settings, desktop), optional Deepgram key | Verified with a fake session; real microphone NEEDS_HARDWARE | `voiceControl.test.ts` |
| "w mojej przeglądarce" / "w swojej przeglądarce" choose the user's or JARVIS's browser | Verified with two in-memory browsers; the real extension pairing NEEDS_HARDWARE | `browserChoice.test.ts` |

## Safety

| Capability | Status | Evidence |
| --- | --- | --- |
| Mail exactly once (idempotency, Sent check before retry, duplicate "wyślij") | Verified | `mailExactlyOnce.test.ts`, `goldenMail.test.ts` |
| An address inside a comment is never the recipient | Verified | `goldenMail.test.ts` M4-4 |
| Clipboard changed outside JARVIS is flagged in the consent | Verified | `goldenMail.test.ts` M4-2 |
| Hostile page, accessibility label or tool output cannot trigger actions | Verified | `untrustedContent.test.ts`, `managedBrowser.test.ts` |
| Vision model output bounded (confidence, inside the image) and confirmed by read-back | Verified (fake model) | `skillsVision.test.ts` V3-V4 |

## Platforms

| Platform | Primitives | Status |
| --- | --- | --- |
| Managed browser (Chromium via Playwright) | launch, navigate, consent wall, open, scroll, comments, focus, select, copy | Verified on fixtures, CI `browser` |
| Linux X11 | clipboard, primary selection, active window, window list, activation, keys, typing, AT-SPI focused text and selection | Verified on a real Xvfb session, CI `desktop` (`tests/desktop/linuxDesktop.test.ts`) |
| Linux Wayland (portal, libei) | input through the RemoteDesktop portal | NEEDS_HARDWARE; reported missing, never faked |
| BrowserBridge (user's Chromium tab) | navigate, selection, copy | Verified with the MV3 extension on Chromium (`bridgeExtension.test.ts`); Firefox: protocol tests only |
| Windows | UI Automation focused element, selection, windows, clipboard, keys | Contract tests with a scripted PowerShell runner; real desktop NEEDS_HARDWARE |
| Android | accessibility focused node, selection, copy, append, scroll, windows | Contract tests with a fake device; Java compiles in the APK build; real phone NEEDS_HARDWARE |
| Vision fallback | escalation after semantic and cache | Works with a fake model; no vision model wired in the app yet (capability reads `missing`) |

## Coding agents (M11-M13)

| Capability | Status | Evidence |
| --- | --- | --- |
| Codex CLI, Claude Code CLI, local Ollama model behind one contract (probe, start, stream, stop, pause, resume, instruction) | Verified on fake CLIs speaking the real JSONL; real Codex NEEDS_HARDWARE | `tests/coder/executor.test.ts` |
| A coding command is a kernel task: "stop", "pauza", "wznów", "co teraz robi codex?", "nie rób release", "dodaj jeszcze X", "pokaż zmiany", "kontynuuj" | Verified | `tests/coder/runtime.test.ts`, `review.test.ts` |
| CONFIRMED only when the repo's own checks pass after the task, something changed and the checks were not edited | Verified | `units.test.ts`, `review.test.ts` |
| Guard: force push, reset --hard, clean, rewrite, push to main, release, deploy, secrets, paths outside the project | Verified | `units.test.ts`, `review.test.ts` |
| Software factory: planner, coder, tester, debugger, reviewer (second backend) through agentRun, cost router TANIO / NORMALNIE / MAKSIMUM | Verified | `tests/coder/factory.test.ts` |
| KOD screen and CODER section in "co robię" | Render tests | `tests/coder/live.test.ts` |
| `npm run jarvis:coder:acceptance -- --mode=fake|local|codex` | fake PASS in CI; codex on the user machine | `tests/coder/acceptance.test.ts` |

## Not available

No real vision model, no Wayland input through the portal, no address book import beyond the
app's contacts, BrowserBridge actions beyond navigate, selection and copy.
