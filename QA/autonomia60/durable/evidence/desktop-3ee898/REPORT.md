# JARVIS final desktop QA — selective evidence

Run `2026-11-05T23-56-39-964Z-desktop-9e028ff3` on clean committed source `3ee898c8bc96612967bae4cb56231912da9f9527`, version `2.1.0-alpha.3`.

Existing command: `npm run qa:desktop` (`node scripts/qa/desktop.cjs`). Runner completed, exit **2**; required tests **not passed**. No failed assertion was recorded.

- Independent normal composer/local task, settings switch, full browser process restart, same task ID, one successful tool audit and persisted assistant reply: **PASS**.
- Normally required license, owner import proof, real local signature, independent WebCrypto verification, normal activation and reload: **PASS** using an ephemeral TEST issuer.
- A, real model + file: **BLOCKED** — both existing Ollama endpoints `http://127.0.0.1:11435` and `http://127.0.0.1:11434` refused connections. No model was selected.
- B, real generation STOP + new task: **BLOCKED** by the same model prerequisite. This run does not prove acceptance of STOP during a real model generation, executor termination, late-consent isolation or the state of already-started activities.
- C and native Electron startup: **BLOCKED** — actual sandbox-on launch stderr reports missing X server/$DISPLAY. No target desktop selection/clipboard/focus/save was executed.

No model, Xvfb, service or system package was installed. Production configuration and license were unchanged. Cleanup completed for only owned processes. Our new private QA key files were removed after evidence extraction. Native/user installation was not performed or inferred from Chromium.

`local-oracle.json` contains only synthetic task/audit and persistence proof. `license-verification.json` contains verification results and a one-way token digest; no token or private key. All key files, screenshots, profiles and raw storage are intentionally omitted. The original ignored run remains local for debugging, with its ephemeral private key files removed. `SHA256SUMS` covers every exported proof file.

A nonfatal Vite scan warning referenced a previous ignored QA bundle. It did not fail this run and is not attributed to the release package.
