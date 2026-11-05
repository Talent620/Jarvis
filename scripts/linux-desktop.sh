#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-start}"
if [[ $# -gt 0 ]]; then shift; fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Ten skrypt uruchamia i pakuje JARVIS-a na Linuksie." >&2
  exit 1
fi
case "$MODE" in
  start|package) ;;
  *) echo "Użycie: bash scripts/linux-desktop.sh [start|package] [argumenty]" >&2; exit 2 ;;
esac

cd "$ROOT"
if [[ ! -x node_modules/electron/dist/electron ]]; then
  echo "Brak środowiska Electron. Uruchom npm ci (bez ELECTRON_SKIP_BINARY_DOWNLOAD)." >&2
  exit 1
fi
if [[ "$MODE" == "start" && -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "Brak sesji graficznej. Uruchom w terminalu pulpitu Linuksa; przez SSH użyj npm run dev." >&2
  exit 1
fi

# Własny lokalny build nie wymaga klucza po każdej rotacji kluczy wydawcy.
# Dystrybucja licencjonowana: JARVIS_LICENSE_REQUIRED=true npm run desktop:ubuntu.
export JARVIS_LICENSE_REQUIRED="${JARVIS_LICENSE_REQUIRED:-false}"
npm run build

if [[ "$MODE" == "package" ]]; then
  exec node node_modules/electron-builder/cli.js --linux AppImage deb --publish never "$@"
fi
exec node node_modules/electron/cli.js "$ROOT" "$@"
