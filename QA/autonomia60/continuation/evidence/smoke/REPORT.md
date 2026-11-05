# JARVIS QA 2026-11-05T19-34-42-012Z-agent-smoke-38326065

Version 2.0.0, work@b3234ca906305712ade35363cffc3524c9a1b21a. Uncommitted source is identified in source.json.

- **D1-local-task PASS** [B, deterministic tool] Normal composer → askJarvis → requestConsent → real add_task → persisted Polish text and audit; browser process restarted, exactly one task and saved history. Not a model/desktop/resume test. Evidence: D1-ui.png, D1-before-restart.json, D1-after-restart.json.
- **S1 BLOCKED** [D] No actual model generation could be attempted; exact discovery stage in ollama.json. Evidence: ollama.json. Unblock: Run in the machine/session with the existing local Ollama service; pass --ollama-url http://127.0.0.1:11435. Do not download a model for this test.
- **S2 NOT_RUN** [D] Full scenario not executed by this smoke runner. See continuation report for known capability defects and dependencies; D1 is not substituted for this scenario. Evidence: ollama.json.
- **S3 NOT_RUN** [D] Full scenario not executed by this smoke runner. See continuation report for known capability defects and dependencies; D1 is not substituted for this scenario. Evidence: ollama.json.
- **S4 NOT_RUN** [C/D or E] Full scenario not executed by this smoke runner. See continuation report for known capability defects and dependencies; D1 is not substituted for this scenario. Evidence: ollama.json.
- **S5 NOT_RUN** [C/D or E] Full scenario not executed by this smoke runner. See continuation report for known capability defects and dependencies; D1 is not substituted for this scenario. Evidence: ollama.json.
- **S6 NOT_RUN** [D] Full scenario not executed by this smoke runner. See continuation report for known capability defects and dependencies; D1 is not substituted for this scenario. Evidence: ollama.json.
- **S7 NOT_RUN** [D] Full scenario not executed by this smoke runner. See continuation report for known capability defects and dependencies; D1 is not substituted for this scenario. Evidence: ollama.json.
- **S8 NOT_RUN** [D] Full scenario not executed by this smoke runner. See continuation report for known capability defects and dependencies; D1 is not substituted for this scenario. Evidence: ollama.json.

Model fixtures: none. User desktop: not inferred from Chromium or Electron tests.
