#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
sed "s|%h/Talent620/Jarvis|$ROOT|g" "$ROOT/deploy/systemd/jarvis-guardian.service" > "$UNIT_DIR/jarvis-guardian.service"
cp "$ROOT/deploy/systemd/jarvis-guardian.timer" "$UNIT_DIR/jarvis-guardian.timer"
systemctl --user daemon-reload
systemctl --user enable --now jarvis-guardian.timer
echo "✅ Zainstalowano i uruchomiono timer jarvis-guardian.timer (co 15 min)."
