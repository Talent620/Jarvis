#!/usr/bin/env bash
set -Eeuo pipefail

MODE="check"
WITH_TOOLS=0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
JARVIS Ubuntu bootstrap

Usage:
  bash scripts/bootstrap-ubuntu.sh --check
  bash scripts/bootstrap-ubuntu.sh --install [--with-tools]
  bash scripts/bootstrap-ubuntu.sh --project-only

Options:
  --check         Check the native Ubuntu environment without changing it.
  --install       Install Ubuntu packages, project dependencies and run verification.
  --project-only  Install project dependencies and run verification.
  --with-tools    Also install sqlite3 and the PostgreSQL client.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --check|--install|--project-only) MODE="${arg#--}" ;;
    --with-tools) WITH_TOOLS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown option: $arg" >&2; usage; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: This bootstrap is intended for Ubuntu/Linux." >&2
  exit 1
fi

is_native_command() {
  local command_name="$1" command_path resolved
  command_path="$(command -v "$command_name" 2>/dev/null || true)"
  [[ -n "$command_path" ]] || return 1
  resolved="$(readlink -f "$command_path" 2>/dev/null || printf '%s' "$command_path")"
  case "$resolved" in
    /mnt/[a-zA-Z]/*|*.exe) return 1 ;;
    *) return 0 ;;
  esac
}

node_is_supported() {
  is_native_command node || return 1
  local major
  major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')"
  [[ "$major" -ge 20 ]]
}

print_status() {
  local name="$1" required="$2"
  if is_native_command "$name"; then
    printf 'OK   %-12s %s\n' "$name" "$(command -v "$name")"
    return 0
  fi
  if [[ "$required" == "required" ]]; then
    printf 'MISS %-12s required native Ubuntu command\n' "$name"
    return 1
  fi
  printf 'OPT  %-12s not installed\n' "$name"
  return 0
}

check_environment() {
  local failed=0
  echo "JARVIS Ubuntu environment"
  print_status git required || failed=1
  print_status npm required || failed=1
  if node_is_supported; then
    printf 'OK   %-12s %s (%s)\n' "node" "$(command -v node)" "$(node --version)"
  else
    echo "MISS node         native Node.js 20 or newer is required"
    failed=1
  fi
  print_status docker optional
  print_status sqlite3 optional
  print_status psql optional

  if is_native_command docker && ! docker info >/dev/null 2>&1; then
    echo "WARN docker       CLI is installed, but the Docker daemon is unavailable"
  fi
  if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "INFO platform     WSL detected; commands under /mnt/* are rejected as Windows binaries"
  fi
  return "$failed"
}

install_system() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "ERROR: apt-get is required for automatic installation." >&2
    exit 1
  fi
  local sudo_cmd=()
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 || {
      echo "ERROR: sudo is required for package installation." >&2
      exit 1
    }
    sudo_cmd=(sudo)
  fi

  echo "Installing Ubuntu build prerequisites..."
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" apt-get install -y \
    ca-certificates curl gnupg git build-essential fakeroot dpkg libarchive-tools \
    libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libatspi2.0-0 libuuid1 xdg-utils

  if ! node_is_supported; then
    echo "Installing native Node.js 22 LTS..."
    local key_tmp
    key_tmp="$(mktemp)"
    trap 'rm -f "$key_tmp"' EXIT
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$key_tmp"
    "${sudo_cmd[@]}" install -d -m 0755 /etc/apt/keyrings
    "${sudo_cmd[@]}" gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg "$key_tmp"
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" |
      "${sudo_cmd[@]}" tee /etc/apt/sources.list.d/nodesource.list >/dev/null
    "${sudo_cmd[@]}" apt-get update
    "${sudo_cmd[@]}" apt-get install -y nodejs
  fi

  if [[ "$WITH_TOOLS" -eq 1 ]]; then
    echo "Installing optional database clients..."
    "${sudo_cmd[@]}" apt-get install -y sqlite3 postgresql-client
  fi
}

setup_project() {
  cd "$ROOT"
  echo "Installing JARVIS dependencies from lockfile..."
  npm ci
  echo "Installing AI Sales dependencies from lockfile..."
  npm --prefix sales-os ci
  echo "Verifying the main application..."
  npm run scan:secrets
  npm run lint
  npm run build
  echo "Verifying AI Sales..."
  npm --prefix sales-os run gates
}

case "$MODE" in
  check)
    check_environment
    ;;
  install)
    install_system
    check_environment
    setup_project
    ;;
  project-only)
    check_environment
    setup_project
    ;;
esac

echo "JARVIS Ubuntu bootstrap: PASS"
