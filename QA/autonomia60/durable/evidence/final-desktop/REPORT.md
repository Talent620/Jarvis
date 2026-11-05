# JARVIS QA 2026-11-05T21-52-02-224Z-desktop-fb4cb0b4

Version 2.1.0-alpha.1, codex/durable-autonomy-20261105@e295f95e3a867de67a8aedb94f1452e0b92cf21c. Uncommitted source is identified in source.json.

Runner completed: true. Required tests passed: false. Exit code: 2.
Mode: isolated licensed test authority. Ollama: not reachable / not selected; model: not selected.

- **independent-local PASS** [web Chromium, no model] Normal composer, Polish task, UI setting switch, full process restart, same task ID, one audit and saved history. License remained required. Not scenario A/B/C proof. Evidence: local-before-restart.json, local-after-restart.json, local-restarted.png.
- **license-issue-activate PASS** [B] Normal licensed gate → owner import proof → real local signature → independent verification → normal activation → reload. No license bypass. Evidence: verification.json, issued-license.png.
- **native-start BLOCKED** [Electron] accessible graphical Electron session Evidence: environment.json, native-launch.json, native-exit.json, electron-stderr.log. Unblock: Run qa:desktop from the logged-in desktop session. Do not guess DISPLAY. Xvfb is neither installed nor started.
- **A BLOCKED** [Electron + real model] Real model prerequisite failed; independent checks continued. Evidence: ollama.json. Unblock: Run in the machine/session with the existing local Ollama service; pass --ollama-url http://127.0.0.1:11435. Do not download a model for this test.
- **B BLOCKED** [Electron + real model] Real model prerequisite failed; independent checks continued. Evidence: ollama.json. Unblock: Run in the machine/session with the existing local Ollama service; pass --ollama-url http://127.0.0.1:11435. Do not download a model for this test.
- **C BLOCKED** [target desktop] Native clipboard/focus/save test is implemented but its environment prerequisites did not pass. Evidence: environment.json, native-launch.json, native-exit.json, electron-stderr.log. Unblock: Run qa:desktop from the logged-in desktop session. Do not guess DISPLAY. Xvfb is neither installed nor started.

Model fixtures: none. User desktop: not inferred from Chromium or Electron tests.
