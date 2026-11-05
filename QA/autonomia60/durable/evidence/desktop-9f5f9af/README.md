# QA desktop — selective evidence

Run 2026-11-05T23-29-40-272Z-desktop-f30481f7 on commit 9f5f9afc868421a0b80197c6d1dd84483833de85.

Independent local checks and normal license issue/activation: PASS. A/B: BLOCKED because both existing Ollama ports refused connection. C/native launch: BLOCKED because no authorized graphical session (stderr proves missing X server/$DISPLAY). Exit code 2 is not full success.

No model, Xvfb or service was installed. Production configuration/license remained unchanged. Original complete run remains in QA/runs; this directory intentionally omits key files, license tokens, browser profiles, screenshots and raw storage. `local-oracle.json` is a minimal extraction of the independent persisted-state checks; `license-verification.json` contains only verification booleans and a one-way token digest.

Initial failed runs from earlier code remain untouched.
