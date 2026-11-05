# JARVIS QA 2026-11-05T19-21-26-251Z-desktop-c1b62aae

Version 2.0.0, work@b3234ca906305712ade35363cffc3524c9a1b21a. Uncommitted source is identified in source.json.

- **Electron-start BLOCKED** [C] Electron failed before renderer startup: no graphical session; Xvfb is not installed. Evidence: environment.json, launch.json, electron-stderr.log, electron-exit.json. Unblock: Run npm run qa:desktop in a logged-in desktop session, or authorize installing Xvfb in this test machine. Do not guess DISPLAY.
- **normal-license-startup NOT_RUN** [C] Renderer never loaded; normal license activation path was not tested. Evidence: report.json.

Model fixtures: none. User desktop: not inferred from Chromium or Electron tests.
