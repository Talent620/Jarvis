# JARVIS local validation

One command checks, step by step, what JARVIS can really do on this machine and writes a
report. It is safe by default: no real mail leaves unless you ask for it.

```bash
npm ci
npm run jarvis:acceptance                       # fixture mode, mock Gmail
npm run jarvis:acceptance -- --mode=managed-browser
npm run jarvis:acceptance -- --mode=local-desktop
npm run jarvis:acceptance -- --mode=managed-browser --send --to=you@example.com
```

## Modes

| Mode | Site | Browser | What it proves |
|---|---|---|---|
| `fixture` | local YouTube fixture (consent wall, lazy comments, injection comment) | managed Chromium, headless | the runtime end to end, deterministic |
| `managed-browser` | real https://www.youtube.com | managed Chromium, visible when a display exists | selectors and timing on the live site |
| `local-desktop` | local fixture | managed Chromium, visible | the desktop: system clipboard, display, input and accessibility tools |

## Steps (progressive)

1. Capabilities: Chromium, display, system clipboard, synthetic input, AT-SPI, microphone
   tool, network to YouTube (managed-browser), Gmail backend. Credentials are checked by name
   only (`JARVIS_SYNC_URL`, `JARVIS_SYNC_TOKEN`), values are never printed.
2. A real browser starts and reaches the site.
3. Golden steps 1-7 (`--runs=N` times), every step confirmed by read-back.
4. Selection and clipboard read back ("Łódź"); in local-desktop also the OS clipboard.
5. Voice session latency with a scripted recognizer (SIMULATED: runtime and browser latency are
   real, microphone and audio are not; live voice is tested in the app).
6. Full scenario 1-8 with mail: mock Gmail on the fixture; on a real site a draft (the consent
   is shown and answered "no", nothing is sent); a real send only with `--send --to=<address>`
   and a configured backend, confirmed only when the message is found in Sent.
7. Cleanup.

A step whose prerequisite did not pass is SKIP, never PASS. Statuses: PASS, FAIL, SKIP,
SIMULATED, NEEDS_HARDWARE, BLOCKED. The verdict is FAIL when any step failed or was blocked,
PASS when every step passed, PARTIAL otherwise.

## Reports

`reports/acceptance-<time>.md` and `.json`: PASS/FAIL per step, times, evidence, latency p50 and
p95, the capability matrix. Screenshots (`reports/acceptance-<time>-<step>.png`) only when a
step fails.

At the end the run commits and pushes only those report files, and only when the current
branch is a mission branch (`claude/*`). `--no-publish` turns this off; CI always runs with it.

## Options

| Option | Meaning |
|---|---|
| `--mode=fixture\|managed-browser\|local-desktop` | see above (default fixture) |
| `--runs=N` | repeat the golden steps (1-50, default 1) |
| `--send` | really send the mail in step 6 (needs `--to` or `JARVIS_ACCEPTANCE_TO`) |
| `--to=<address>` | recipient for `--send`, e.g. your own address |
| `--no-publish` | do not commit or push the report |
| `--headless=false` | show the browser even in fixture mode |
