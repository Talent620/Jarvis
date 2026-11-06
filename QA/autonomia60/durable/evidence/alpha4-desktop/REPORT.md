# Desktop QA alpha.4

Run `2026-11-06T00-38-45-202Z-desktop-6fbd40e3`, commit `d2bc13b0a63d52e22be7307ecb39809fedf8b258`. Runner completed with exit 2: required tests not passed.

- Independent normal composer/local command, settings, restart and persistence: PASS, web Chromium with isolated profile and no model.
- Normal license issue, signature verification, activation and reload: PASS with ephemeral test issuer; not scenario B.
- A and B: BLOCKED; Ollama was unreachable on localhost 11434 and 11435. No real generation or STOP result is claimed.
- C and native Electron: BLOCKED; no X/DISPLAY. No clipboard, focus or saved-file result is claimed.

No system installation, model download, Xvfb or user production profile was used. Newly generated private QA keys were deleted. Screenshots, profiles, raw tokens and browser storage are not exported. `local-oracle.json` retains only synthetic task, audit, chat and settings evidence.
