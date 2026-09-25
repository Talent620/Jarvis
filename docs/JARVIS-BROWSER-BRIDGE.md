# JARVIS BrowserBridge

A small WebExtension that lets the JARVIS desktop app see and act on the current tab of your own
Chromium or Firefox, next to the managed browser JARVIS starts itself.

## Install (unpacked)

- Chromium / Chrome / Edge: `chrome://extensions`, Developer mode, "Load unpacked",
  choose `extension/browser-bridge`.
- Firefox 121+: `about:debugging#/runtime/this-firefox`, "Load Temporary Add-on", choose
  `extension/browser-bridge/manifest.json` (the same MV3 manifest; `background.scripts` is used).

## Pairing

1. In JARVIS ask for a pairing code (desktop IPC `jarvis:bridge` `{ method: "pair" }`). The code has
   6 digits, lives 2 minutes, works once, and allows 5 attempts.
2. In the extension's options page enter the code (port 47823 by default) and press "Połącz".
3. JARVIS answers with a session token; the extension keeps it in its storage and uses it on
   every reconnect. JARVIS stores only the SHA-256 of the token (`jarvis-bridge-tokens.json` in
   the app's user data folder, mode 600). "Zapomnij parowanie" in the extension or
   `{ method: "revoke", extensionId }` in JARVIS ends it.

## Security

- The server listens on 127.0.0.1 only and accepts WebSocket connections only from
  `chrome-extension://` or `moz-extension://` origins (a web page cannot open it: its origin is
  the page's origin). Remote addresses other than loopback are refused.
- The first message must be `hello` with a valid token or pairing code within 5 s; otherwise the
  socket is closed. Every message is validated (types, sizes, formats) before use.
- The extension answers only these commands: `tab.get`, `tab.navigate` (http and https only),
  `page.selection`, `page.copySelection`. It reports the active tab and the text selection; it
  does not read anything else from pages.

## Protocol (v1)

Extension to JARVIS: `hello {v, browser, extensionId, token | pairCode}`, `result {id, ok, data,
error}`, `event {event: "tab", tabId, url, title}`, `event {event: "selection", tabId, text}`,
`ping`. JARVIS to extension: `welcome {v, token?}`, `error {code, message}`, `cmd {id, method,
params}`, `pong`.

## Fallback

The bridge is the `browser.bridge` capability. When no paired extension is connected it is
`missing`, every bridge command returns NEEDS_CAPABILITY (never a pretended success), and the
runtime keeps using the managed browser, which is the default target of the golden scenario.

## Tests

- `tests/runtime/bridgeProtocol.test.ts`: validation, pairing, tokens, origin and loopback checks,
  the server with a stand-in extension (wrong token, wrong origin, silence, disconnect).
- `tests/browser/bridgeExtension.test.ts`: the real extension in Chromium: pairing through its
  options page, current tab and selection observed, navigation confirmed by reading the tab back,
  token reuse on reconnect. Firefox uses the same manifest and code but is not run here (no
  Firefox build in this environment).
