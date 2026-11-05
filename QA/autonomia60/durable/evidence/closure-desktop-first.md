# JARVIS QA 2026-11-05T22-43-33-751Z-desktop-3d0da2ee

Version 2.1.0-alpha.2, codex/skills-integration-20261105@fb17f9755faad72295cb125563ba2b0220d9319d. Uncommitted source is identified in source.json.

Runner completed: true. Required tests passed: false. Exit code: 1.
Mode: isolated licensed test authority. Ollama: not reachable / not selected; model: not selected.

- **license-issue-activate FAIL** [B] locator.waitFor: Timeout 20000ms exceeded.
Call log:
[2m  - waiting for locator('.sheet').first() to be hidden[22m
[2m    - locator resolved to visible <div class="sheet" aria-busy="true" aria-live="polite">…</div>[22m
[2m    42 × locator resolved to visible <div class="sheet">…</div>[22m
 Evidence: error.txt, vite.log.
- **native-start BLOCKED** [Electron] accessible graphical Electron session Evidence: environment.json, native-launch.json, native-exit.json, electron-stderr.log. Unblock: Run qa:desktop from the logged-in desktop session. Do not guess DISPLAY. Xvfb is neither installed nor started.
- **A BLOCKED** [Electron + real model] Real model prerequisite failed; independent checks continued. Evidence: ollama.json. Unblock: Run in the machine/session with the existing local Ollama service; pass --ollama-url http://127.0.0.1:11435. Do not download a model for this test.
- **B BLOCKED** [Electron + real model] Real model prerequisite failed; independent checks continued. Evidence: ollama.json. Unblock: Run in the machine/session with the existing local Ollama service; pass --ollama-url http://127.0.0.1:11435. Do not download a model for this test.
- **C BLOCKED** [target desktop] Native clipboard/focus/save test is implemented but its environment prerequisites did not pass. Evidence: environment.json, native-launch.json, native-exit.json, electron-stderr.log. Unblock: Run qa:desktop from the logged-in desktop session. Do not guess DISPLAY. Xvfb is neither installed nor started.

Model fixtures: none. User desktop: not inferred from Chromium or Electron tests.
