# JARVIS QA 2026-11-05T19-34-05-927Z-preflight-e8615a3e

Version 2.0.0, work@b3234ca906305712ade35363cffc3524c9a1b21a. Uncommitted source is identified in source.json.

- **environment PASS** [A] Recorded current checkout, source fingerprint and non-secret session/tool availability. Evidence: environment.json, source.json.
- **Ollama-discovery BLOCKED** [D prerequisite] Source: unresolved: no user profile available; bounded discovery of both known ports; selected: none. No generation claimed. Evidence: ollama.json. Unblock: Run in the machine/session with the existing local Ollama service; pass --ollama-url http://127.0.0.1:11435. Do not download a model for this test.

Model fixtures: none. User desktop: not inferred from Chromium or Electron tests.
