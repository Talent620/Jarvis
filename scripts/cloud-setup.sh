#!/usr/bin/env bash
# SessionStart bootstrap for Claude Code cloud sessions (CLAUDE_CODE_REMOTE=true).
# Idempotent and fast on repeat runs. Never fails the session: problems are reported as
# warnings and the script exits 0 (docs/mission/DECISIONS.md D-002).
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 0

log() { printf '[cloud-setup] %s\n' "$*"; }

# Persist a variable for later commands in this session when the harness offers an env file.
persist_env() {
  export "$1=$2"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    printf 'export %s=%q\n' "$1" "$2" >> "$CLAUDE_ENV_FILE"
  fi
}

# Electron binaries come from GitHub releases that can return 403 in the cloud.
persist_env ELECTRON_SKIP_BINARY_DOWNLOAD 1

# 1. Dependencies: skip npm ci when package-lock.json is unchanged since the last install.
STAMP_DIR="node_modules/.cache/jarvis-cloud-setup"
STAMP="$STAMP_DIR/lock.sha256"
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ -d node_modules ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$LOCK_HASH" ]; then
  log "deps: npm ci skipped (package-lock.json unchanged)"
else
  NPM_LOG="$(mktemp -t jarvis-npm-ci.XXXXXX)"
  if npm ci --no-audit --no-fund >"$NPM_LOG" 2>&1; then
    mkdir -p "$STAMP_DIR" && printf '%s' "$LOCK_HASH" > "$STAMP"
    log "deps: npm ci done"
  else
    log "WARN deps: npm ci failed, last lines:"
    tail -n 15 "$NPM_LOG"
  fi
  rm -f "$NPM_LOG"
fi

# 2. Test browser (docs/mission/DECISIONS.md D-004, D-015). Prefer the Chromium build that
# matches the pinned Playwright: its own download, else the same Chrome for Testing version
# from storage.googleapis.com, and only then the older image-provided Chromium.
CFT_DIR="$HOME/.cache/jarvis-chrome"
PW_CFT_VERSION="$(node -e "try{const b=JSON.parse(require('fs').readFileSync('node_modules/playwright-core/browsers.json','utf8')).browsers.find(x=>x.name==='chromium');process.stdout.write(b.browserVersion||'')}catch{}" 2>/dev/null)"

matching_browser() {
  if [ -n "${JARVIS_CHROMIUM_PATH:-}" ] && [ -x "${JARVIS_CHROMIUM_PATH}" ]; then
    printf '%s' "$JARVIS_CHROMIUM_PATH"; return 0
  fi
  if [ -d node_modules/playwright-core ]; then
    local p
    p="$(node -e "try{const p=require('playwright-core').chromium.executablePath();if(require('fs').existsSync(p))process.stdout.write(p)}catch{}" 2>/dev/null)"
    if [ -n "$p" ]; then printf '%s' "$p"; return 0; fi
  fi
  if [ -n "$PW_CFT_VERSION" ] && [ -x "$CFT_DIR/chrome/linux-$PW_CFT_VERSION/chrome-linux64/chrome" ]; then
    printf '%s' "$CFT_DIR/chrome/linux-$PW_CFT_VERSION/chrome-linux64/chrome"; return 0
  fi
  return 1
}

BROWSER="$(matching_browser)"
if [ -z "$BROWSER" ] && [ -d node_modules/playwright ]; then
  log "browser: trying npx playwright install chromium"
  timeout 120 npx --no-install playwright install chromium >/dev/null 2>&1 || log "WARN browser: playwright install failed (CDN blocked?)"
  BROWSER="$(matching_browser)"
fi
if [ -z "$BROWSER" ] && [ -n "$PW_CFT_VERSION" ]; then
  log "browser: trying Chrome for Testing $PW_CFT_VERSION via @puppeteer/browsers"
  timeout 300 npx --yes @puppeteer/browsers install "chrome@$PW_CFT_VERSION" --path "$CFT_DIR" >/dev/null 2>&1 \
    || log "WARN browser: Chrome for Testing download failed"
  BROWSER="$(matching_browser)"
fi
if [ -z "$BROWSER" ]; then
  for c in "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}/chromium" /opt/pw-browsers/chromium; do
    if [ -x "$c" ]; then BROWSER="$c"; log "WARN browser: using image Chromium, version may not match Playwright"; break; fi
  done
fi
if [ -n "$BROWSER" ]; then
  persist_env JARVIS_CHROMIUM_PATH "$BROWSER"
  log "browser: $BROWSER"
else
  log "WARN browser: none available, browser tests will report BLOCKED"
fi

# 3. Xvfb for headed browser or Electron runs.
if ! command -v Xvfb >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
    { timeout 240 apt-get install -y -qq xvfb || { timeout 120 apt-get update -qq && timeout 240 apt-get install -y -qq xvfb; }; } >/dev/null 2>&1 \
      && log "xvfb: installed" || log "WARN xvfb: install failed"
  else
    log "WARN xvfb: missing and cannot install"
  fi
else
  log "xvfb: present"
fi

# 4. Linux desktop adapter test tools (npm run test:desktop): X11 tools, AT-SPI, GTK.
DESKTOP_PKGS="dbus-x11 openbox xdotool xclip wmctrl at-spi2-core gir1.2-atspi-2.0 gir1.2-gtk-3.0 python3-gi"
if ! command -v xdotool >/dev/null 2>&1 || ! command -v openbox >/dev/null 2>&1 || [ ! -x /usr/libexec/at-spi-bus-launcher ]; then
  if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
    # shellcheck disable=SC2086
    { timeout 300 apt-get install -y -qq --no-install-recommends $DESKTOP_PKGS || { timeout 120 apt-get update -qq && timeout 300 apt-get install -y -qq --no-install-recommends $DESKTOP_PKGS; }; } >/dev/null 2>&1 \
      && log "desktop tools: installed" || log "WARN desktop tools: install failed (desktop tests will skip locally)"
  else
    log "WARN desktop tools: missing and cannot install"
  fi
else
  log "desktop tools: present"
fi

exit 0
