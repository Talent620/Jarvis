# JARVIS runtime architecture

What is described here exists in the code and is covered by tests. Items that need hardware this
repository cannot reach are marked NEEDS_HARDWARE; see `docs/JARVIS-CAPABILITIES.md`.

## One path from words to a verified effect

```
microphone / typed text
  -> VoiceSession (STT chain, barge-in, echo, wake word / push-to-talk)      src/lib/runtime/voice
  -> JarvisRuntime: four lanes                                               src/lib/runtime/lanes
       REFLEX        controls without an LLM (stop, pauza, wznów, cofnij, tak/nie)
       CONVERSATION  side chat and "co teraz robisz?" from the Situation Snapshot
       ACTION        one serial queue of tasks, each step verified
       PERCEPTION    environment events -> kernel
  -> ActionSession: command -> task -> steps                                 src/lib/runtime/session.ts
  -> performAction: capability check -> ActionStarted (idempotency)
       -> env.act (deadline) -> read-back (deadline) -> postcondition        src/lib/runtime/actions.ts
       -> ActionVerified (CONFIRMED) or ActionFailed (truth state)           src/lib/runtime/postconditions.ts
  -> Kernel: single writer, reducer, dedup, journal                          src/lib/runtime/kernel.ts
  -> ComputerEnvironment (the only door to the computer)                     src/lib/runtime/env/types.ts
```

The same runtime runs on fixtures (tests, CI, `npm run jarvis:acceptance -- --mode=fixture`) and in
production (Electron): only the `ComputerEnvironment` and the mail service differ.

## Kernel (single writer)

- Every change is a typed event (`events.ts`) reduced by `reducer.ts` into `KernelState`: tasks,
  steps, actions, idempotency keys, referents, page, window, clipboard, consents, capabilities.
- Dedup by event id, by utterance id and by identical STT finals within 800 ms, so a repeated
  recognizer final never repeats an action.
- Each task has an AbortController (`kernel.signal`) and a pause gate (`waitRunnable`): "stop"
  aborts the running tool, "pauza" holds the next micro-action.
- Durable events go to a journal (IndexedDB through Dexie in the app). On restart running tasks
  come back paused and a started external action comes back UNKNOWN_AFTER_ATTEMPT, never retried.

## Truth states

`SIMULATED, ATTEMPTED, CONFIRMED, UNKNOWN_AFTER_ATTEMPT, FAILED, BLOCKED, NEEDS_PERMISSION,
NEEDS_HARDWARE, NEEDS_CAPABILITY` (`truth.ts`). CONFIRMED is produced in exactly two places: a
postcondition that matched a read-back (`verify`) and a mail found in Sent (`mail.ts`). An action
whose result cannot be read at all is ATTEMPTED. External effects are journalled as attempted
before they can happen and are never retried automatically. A tool that does not answer in time
is aborted; a local step then ends FAILED unless the read-back proves it, an external one ends
UNKNOWN_AFTER_ATTEMPT.

## References and the Situation Snapshot

`referents.ts` keeps pages, collections, items, selections and the clipboard with an observation
epoch; a re-render or navigation invalidates what depended on it. `resolve.ts` and `polish.ts`
resolve Polish references ("pierwszy komentarz", "nie ten, następny", "wróćmy do komentarza",
"pierwsze cztery litery" over graphemes). `snapshot.ts` renders a bounded (1200 characters)
description for the conversation model, with screen text quoted as data.

## Consent and untrusted content

- Action classes and user policies (`src/lib/permissions.ts`); the send step asks exactly once,
  with the final recipient and content, and only strict words ("tak", "wyślij") grant it.
- Screen text, clipboard, accessibility labels and tool output carry provenance. A summary of
  screen text goes to an isolated model with no tools and no history (`untrusted.ts`). After
  untrusted content entered the context, classified outbound tools ask again.
- A conversation reply that is not usable text (object, empty, JSON or tool-call blob) is neither
  spoken nor parsed; model calls have a deadline.

## Environments (`ComputerEnvironment`)

| Environment | Where | Primitives |
| --- | --- | --- |
| ManagedBrowser | `src/node/managedBrowser.ts` (Electron main, Playwright) | launch, navigate, consent wall, open, scroll, collections, focus, text selection, clipboard; reads in an isolated world |
| BrowserBridge | `src/node/bridge/*`, `extension/browser-bridge` | the user's own tab: navigate, selection, copy; loopback WebSocket, pairing code then token |
| Linux desktop | `src/node/linux/*` | X11/Wayland clipboard, primary selection, active window, window list, activation, keys and typing, AT-SPI focused text and selection |
| Windows desktop | `src/node/windows/uia.ts` | UI Automation focused element, TextPattern selection, windows, clipboard, SendKeys |
| Android | `src/lib/runtime/env/android.ts` + accessibility service | focused node, selection, copy, append text, scroll, windows, node tree |
| Composite | `src/node/compositeEnvironment.ts` | browser actions to the browser, desktop actions to the desktop |
| Escalating (vision) | `src/lib/runtime/env/vision.ts` | wraps any of the above: semantic, then verified cached locator, then vision, then not found |

The renderer talks to the main process through a validated IPC adapter (`env/ipc.ts`,
`src/node/envHost.ts`): an allow-list of action and read kinds, duplicate call ids refused.

## Mail

`mail.ts` sends exactly once per idempotency key (recipient, subject, body) and confirms by
finding the message in Sent; a timeout or a network error is resolved from Sent before any retry.
`gmailService.ts` implements it on the app's Gmail connection; tests use a mock with the same
contract. Contacts are matched with Polish inflection (`contacts.ts`); two matches mean a
question at runtime.

## Voice

Provider catalog (`voice/catalog.ts`), Deepgram and OpenAI Realtime streaming adapters, a batch
Whisper fallback with a turn detector, a fallback chain that reports switches, barge-in that
cancels TTS in the same tick, echo rejection against recent speech, wake word and push-to-talk,
partials that only speculate reads, a clip cache for short confirmations, and latency marks
(`voice/latency.ts`).

## Skills, locator cache, visibility (M10)

- `locatorCache.ts`: locators kept only after a CONFIRMED action; they die on age, a changed page
  signature, or failures (vision boxes on the first).
- `skills.ts`: "zapamiętaj to jako X" stores the confirmed tail of recent commands as Polish
  utterances; "powtórz X" sends them through the action lane again, each verified anew. A real
  failure disables the skill; a send step stops at the user's consent.
- `diagnostics.ts`: `statusView` for the "co robię" panel (`src/components/RuntimeStatusPanel.tsx`,
  PAUZA / WZNÓW / STOP through the same control path as speech) and a redacted local diagnostics
  export.

## Acceptance

`npm run jarvis:acceptance` (`scripts/acceptance/run.ts`, `src/node/acceptance/*`) runs the golden
scenario in modes fixture, managed-browser and local-desktop, writes `reports/acceptance-*.md`
and `.json` and, on a `claude/*` branch, commits only those files. See
`docs/JARVIS-LOCAL-VALIDATION.md`.
