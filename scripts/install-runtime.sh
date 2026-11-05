#!/usr/bin/env bash
# Install the local task server independently of the desktop window.
set -Eeuo pipefail
umask 077

jarvis_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
jarvis_source="${JARVIS_RUNTIME_SOURCE_DIR:-$jarvis_root/server/runtime}"
jarvis_app_dir="${JARVIS_INSTALL_DIR:-$HOME/.local/opt/jarvis}"
jarvis_bin_dir="${JARVIS_BIN_DIR:-$HOME/.local/bin}"
jarvis_data_dir="${JARVIS_RUNTIME_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/jarvis/runtime}"
jarvis_unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
jarvis_start=1
jarvis_work=""
jarvis_release=""
jarvis_activated=0
jarvis_previous=""
jarvis_success=0
jarvis_systemd=0
jarvis_was_enabled=0
jarvis_was_active=0
jarvis_service_touched=0
jarvis_wrapper_stage=""
jarvis_unit_stage=""
jarvis_old_running=0
jarvis_old_stopped=0
jarvis_new_started=0
jarvis_rollback_dir=""
jarvis_keep_rollback=0
jarvis_control="$jarvis_root/scripts/runtime-install-control.mjs"
jarvis_log_dir="${XDG_STATE_HOME:-$HOME/.local/state}/jarvis"

fail() { printf 'JARVIS Runtime: %s\n' "$*" >&2; exit 1; }
for jarvis_arg in "$@"; do
  case "$jarvis_arg" in
    --no-start) jarvis_start=0 ;;
    --help|-h) printf 'Użycie: bash scripts/install-runtime.sh [--no-start]\nInstaluje serwer i usługę systemd użytkownika; nie zmienia danych ani kluczy.\n'; exit 0 ;;
    *) fail "Nieznana opcja: $jarvis_arg" ;;
  esac
done
[[ $(uname -s) == Linux ]] || fail 'Usługa użytkownika wymaga Linuksa.'
((EUID != 0)) || fail 'Uruchom instalator jako zwykły użytkownik, bez sudo.'
[[ -f "$jarvis_source/cli.mjs" && -f "$jarvis_source/server.mjs" ]] || fail 'Brak kompletnych plików server/runtime.'
[[ -f "$jarvis_control" ]] || fail 'Brak scripts/runtime-install-control.mjs.'
command -v node >/dev/null || fail 'Potrzebny jest Node.js 20 lub nowszy.'
jarvis_node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
[[ "$jarvis_node_major" =~ ^[0-9]+$ ]] && ((jarvis_node_major >= 20)) || fail 'Potrzebny jest Node.js 20 lub nowszy.'
jarvis_node=$(node -p 'process.execPath')
for jarvis_path in "$jarvis_app_dir" "$jarvis_bin_dir" "$jarvis_data_dir" "$jarvis_unit_dir" "$jarvis_node" "$jarvis_log_dir"; do
  [[ "$jarvis_path" == /* && "$jarvis_path" != / && "$jarvis_path" != *$'\n'* && "$jarvis_path" != *$'\r'* ]] || fail 'Ścieżki instalacji muszą być bezwzględne i nie mogą zawierać końca linii.'
done
jarvis_target="$jarvis_app_dir/runtime"
jarvis_wrapper="$jarvis_bin_dir/jarvis-runtime"
jarvis_unit="$jarvis_unit_dir/jarvis-runtime.service"
[[ ! -e "$jarvis_target" || -L "$jarvis_target" ]] || fail "Istniejący $jarvis_target nie jest katalogiem zarządzanym przez instalator. Przenieś własne pliki przed instalacją."
for jarvis_path in "$jarvis_wrapper" "$jarvis_unit"; do
  [[ ! -L "$jarvis_path" && (! -e "$jarvis_path" || -f "$jarvis_path") ]] || fail "Nieprawidłowy plik docelowy: $jarvis_path"
done
runtime_control() { "$jarvis_node" "$jarvis_control" "$1" "$jarvis_data_dir" "$jarvis_work/runtime-before.json" "${2:-$jarvis_release}" "${3:-}"; }

cleanup() {
  local jarvis_status=$?
  trap - EXIT INT TERM
  if ((jarvis_status != 0 && (jarvis_activated || jarvis_old_stopped) && !jarvis_success)); then
    if ((jarvis_systemd && jarvis_service_touched)); then
      systemctl --user stop jarvis-runtime.service >/dev/null 2>&1 || true
      if ((!jarvis_was_enabled)); then systemctl --user disable jarvis-runtime.service >/dev/null 2>&1 || true; fi
    fi
    if ((jarvis_new_started)); then runtime_control stop-current >/dev/null 2>&1 || true; fi
    if ((jarvis_activated)); then
      if [[ -n "$jarvis_previous" ]]; then
        ln -s -- "$jarvis_previous" "$jarvis_work/rollback-link"
        mv -Tf -- "$jarvis_work/rollback-link" "$jarvis_target"
      else
        rm -f -- "$jarvis_target"
      fi
      for jarvis_name in wrapper unit; do
        if [[ "$jarvis_name" == wrapper ]]; then jarvis_path=$jarvis_wrapper; else jarvis_path=$jarvis_unit; fi
        if [[ -f "$jarvis_work/$jarvis_name.old" ]]; then cp -p -- "$jarvis_work/$jarvis_name.old" "$jarvis_path"; else rm -f -- "$jarvis_path"; fi
      done
    fi
    if ((jarvis_systemd)); then
      systemctl --user daemon-reload >/dev/null 2>&1 || true
      if ((jarvis_was_active && jarvis_old_stopped)); then systemctl --user restart jarvis-runtime.service >/dev/null 2>&1 || true; fi
    fi
    if ((jarvis_old_stopped)); then
      jarvis_keep_rollback=1
      if ! runtime_control restore "$jarvis_rollback_dir" "$jarvis_log_dir/runtime.log"; then
        printf 'Przywrócono pliki, ale nie potwierdzono startu poprzedniego serwera. Sprawdź %s.\n' "$jarvis_log_dir/runtime.log" >&2
      fi
    fi
    printf 'Wycofano zmianę instalacji serwera. Dane zadań pozostały w %s.\n' "$jarvis_data_dir" >&2
  fi
  if ((jarvis_status != 0 && !jarvis_success)) && [[ -n "$jarvis_release" ]]; then rm -rf -- "$jarvis_release"; fi
  if ((!jarvis_keep_rollback)) && [[ -n "$jarvis_rollback_dir" ]]; then rm -rf -- "$jarvis_rollback_dir"; fi
  [[ -z "$jarvis_wrapper_stage" ]] || rm -f -- "$jarvis_wrapper_stage"
  [[ -z "$jarvis_unit_stage" ]] || rm -f -- "$jarvis_unit_stage"
  [[ -z "$jarvis_work" ]] || rm -rf -- "$jarvis_work"
  exit "$jarvis_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p -- "$jarvis_app_dir/runtime-releases" "$jarvis_bin_dir" "$jarvis_data_dir" "$jarvis_unit_dir"
chmod 700 "$jarvis_data_dir"
jarvis_work=$(mktemp -d "$jarvis_app_dir/.runtime-install.XXXXXXXX")
jarvis_release=$(mktemp -d "$jarvis_app_dir/runtime-releases/release.XXXXXXXX")
cp -R -- "$jarvis_source/." "$jarvis_release/"
node --check "$jarvis_release/cli.mjs"
node --check "$jarvis_release/server.mjs"
[[ ! -L "$jarvis_target" ]] || jarvis_previous=$(readlink "$jarvis_target")
[[ ! -f "$jarvis_wrapper" ]] || cp -p -- "$jarvis_wrapper" "$jarvis_work/wrapper.old"
[[ ! -f "$jarvis_unit" ]] || cp -p -- "$jarvis_unit" "$jarvis_work/unit.old"
if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  jarvis_systemd=1
  if systemctl --user is-enabled --quiet jarvis-runtime.service; then jarvis_was_enabled=1; fi
  if systemctl --user is-active --quiet jarvis-runtime.service; then jarvis_was_active=1; fi
fi
if ((jarvis_start)); then
  jarvis_rollback_dir=$(mktemp -d "$jarvis_app_dir/runtime-releases/rollback.XXXXXXXX")
  jarvis_old_running=$(runtime_control capture "$jarvis_rollback_dir" "$jarvis_target")
  if ((jarvis_was_active)); then
    jarvis_service_pid=$(systemctl --user show --property=MainPID --value jarvis-runtime.service)
    jarvis_owned_pid=$("$jarvis_node" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid || "")' "$jarvis_work/runtime-before.json")
    [[ "$jarvis_old_running" == 1 && "$jarvis_service_pid" == "$jarvis_owned_pid" ]] || fail 'Działająca usługa systemd nie należy do wybranego katalogu danych. Nie zatrzymano jej.'
  fi
fi
{
  printf '#!/usr/bin/env bash\nset -e\nexport JARVIS_RUNTIME_DATA_DIR='
  printf '%q' "$jarvis_data_dir"
  printf '\ncd -- '
  printf '%q' "$jarvis_app_dir"
  printf '\nexec '
  printf '%q ' "$jarvis_node" "$jarvis_target/cli.mjs"
  printf '"$@"\n'
} > "$jarvis_work/wrapper"
chmod 755 "$jarvis_work/wrapper"
# systemd has its own escaping (percent specifiers and dollar expansion).
unit_arg() {
  local jarvis_value=$1
  jarvis_value=${jarvis_value//\\/\\\\}
  jarvis_value=${jarvis_value//\"/\\\"}
  jarvis_value=${jarvis_value//%/%%}
  jarvis_value=${jarvis_value//\$/\$\$}
  printf '"%s"' "$jarvis_value"
}
{
  printf '[Unit]\nDescription=JARVIS local task runtime\nAfter=network.target\nStartLimitIntervalSec=60\nStartLimitBurst=3\n\n[Service]\nType=simple\nExecStart=/usr/bin/env '
  unit_arg "$jarvis_wrapper"
  printf ' start\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=20\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n'
} > "$jarvis_work/unit"
chmod 644 "$jarvis_work/unit"
# Stage beside each destination so rename remains atomic across XDG mounts.
jarvis_wrapper_stage=$(mktemp "$jarvis_bin_dir/.jarvis-runtime.XXXXXXXX")
jarvis_unit_stage=$(mktemp "$jarvis_unit_dir/.jarvis-runtime.XXXXXXXX")
cp -p -- "$jarvis_work/wrapper" "$jarvis_wrapper_stage"
cp -p -- "$jarvis_work/unit" "$jarvis_unit_stage"
ln -s -- "runtime-releases/$(basename "$jarvis_release")" "$jarvis_work/current"
jarvis_activated=1
mv -Tf -- "$jarvis_work/current" "$jarvis_target"
mv -f -- "$jarvis_wrapper_stage" "$jarvis_wrapper"
mv -f -- "$jarvis_unit_stage" "$jarvis_unit"

if ((jarvis_systemd)); then
  systemctl --user daemon-reload
  if ((jarvis_start)); then
    jarvis_service_touched=1
    if ((jarvis_old_running)); then
      jarvis_old_stopped=1
      if ((jarvis_was_active)); then systemctl --user stop jarvis-runtime.service; runtime_control wait; else runtime_control stop; fi
    fi
    systemctl --user enable jarvis-runtime.service
    systemctl --user reset-failed jarvis-runtime.service || true
    jarvis_new_started=1
    systemctl --user restart jarvis-runtime.service
    runtime_control verify
    systemctl --user is-active --quiet jarvis-runtime.service || fail 'Nowa usługa systemd nie jest aktywna.'
    printf 'Serwer JARVIS działa jako usługa użytkownika; zamknięcie okna go nie zatrzymuje.\n'
  else
    printf 'Zainstalowano usługę bez uruchamiania. Start: systemctl --user enable --now jarvis-runtime.service\n'
  fi
else
  if ((jarvis_start)); then
    if ((jarvis_old_running)); then jarvis_old_stopped=1; runtime_control stop; fi
    jarvis_new_started=1
    runtime_control launch "$jarvis_target" "$jarvis_log_dir/runtime.log"
    runtime_control verify
    printf 'Nowa wersja serwera JARVIS działa w tle bez systemd.\n'
  else
    printf 'Zainstalowano serwer bez uruchamiania; działający proces pozostawiono bez zmian.\n'
  fi
  printf 'Możesz też uruchomić sam serwer w terminalu:\n  %q start\n' "$jarvis_wrapper"
  printf 'W tym trybie serwer działa tylko tak długo, jak jego proces; nie ma automatycznego restartu po awarii.\n'
fi
jarvis_success=1
printf 'Diagnostyka: %q status\nTest modelu: %q test\n' "$jarvis_wrapper" "$jarvis_wrapper"
printf 'Praca po wylogowaniu zależy od ustawień systemu (linger); instalator ich nie zmienia.\n'
