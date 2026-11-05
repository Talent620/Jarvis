#!/usr/bin/env bash
# Per-user Linux install. SOURCE must point at the intended AppImage; no guessed release URL.
set -Eeuo pipefail
umask 077

jarvis_source="${JARVIS_INSTALL_URL:-}"
jarvis_sha="${JARVIS_INSTALL_SHA256:-}"
jarvis_launch=1
jarvis_install_dir="${JARVIS_INSTALL_DIR:-$HOME/.local/opt/jarvis}"
jarvis_bin_dir="${JARVIS_BIN_DIR:-$HOME/.local/bin}"
jarvis_apps_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
jarvis_state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/jarvis"
jarvis_work=""
jarvis_changed=0
jarvis_committed=0
jarvis_paths=()
jarvis_backups=()

usage() {
  cat <<'HELP'
Użycie: bash install-linux.sh [--no-launch] [--sha256 SUMA] URL_LUB_PLIK_APPIMAGE
Alternatywnie: JARVIS_INSTALL_URL oraz JARVIS_INSTALL_SHA256.
Instalacja w katalogu użytkownika, bez sudo. Obsługiwany Linux x86_64.
HELP
}
fail() { printf 'JARVIS: %s\n' "$*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --no-launch) jarvis_launch=0 ;;
    --sha256) (($# >= 2)) || fail 'Brakuje sumy po --sha256.'; jarvis_sha=$2; shift ;;
    --help|-h) usage; exit 0 ;;
    --*) fail "Nieznana opcja: $1" ;;
    *) [[ -z "$jarvis_source" ]] || fail 'Podaj tylko jedno źródło AppImage.'; jarvis_source=$1 ;;
  esac
  shift
done
[[ -n "$jarvis_source" ]] || { usage >&2; exit 2; }
[[ $(uname -s) == Linux ]] || fail 'Ten instalator jest przeznaczony dla Linuksa.'
case "$(uname -m)" in x86_64|amd64) ;; *) fail 'Ta paczka wymaga procesora x86_64 (AMD/Intel 64-bit).' ;; esac
((EUID != 0)) || fail 'Uruchom instalator jako zwykły użytkownik, bez sudo.'
if [[ -n "$jarvis_sha" && ! "$jarvis_sha" =~ ^[[:xdigit:]]{64}$ ]]; then fail 'Nieprawidłowa suma SHA256.'; fi
for jarvis_path in "$jarvis_install_dir" "$jarvis_bin_dir" "$jarvis_apps_dir" "$jarvis_state_dir"; do
  [[ "$jarvis_path" == /* && "$jarvis_path" != / && "$jarvis_path" != *$'\n'* && "$jarvis_path" != *$'\r'* ]] || fail 'Katalogi instalacji muszą być bezwzględnymi ścieżkami bez znaków nowej linii.'
done
for jarvis_command in mktemp mkdir cp mv chmod sha256sum nohup; do
  command -v "$jarvis_command" >/dev/null || fail "Brakuje polecenia: $jarvis_command";
done

cleanup() {
  local jarvis_status=$?
  trap - EXIT INT TERM
  if ((jarvis_status != 0 && jarvis_changed && !jarvis_committed)); then
    printf 'Instalacja nie powiodła się; przywracam poprzednie pliki.\n' >&2
    for jarvis_index in "${!jarvis_paths[@]}"; do
      if [[ -f "${jarvis_backups[$jarvis_index]}" ]]; then
        cp -p -- "${jarvis_backups[$jarvis_index]}" "${jarvis_paths[$jarvis_index]}" || true
      else
        rm -f -- "${jarvis_paths[$jarvis_index]}" || true
      fi
    done
  fi
  [[ -z "$jarvis_work" ]] || rm -rf -- "$jarvis_work"
  exit "$jarvis_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p -- "$jarvis_install_dir" "$jarvis_bin_dir" "$jarvis_apps_dir" "$jarvis_state_dir"
jarvis_work=$(mktemp -d "$jarvis_install_dir/.install.XXXXXXXX")
jarvis_target="$jarvis_install_dir/JARVIS.AppImage"
jarvis_wrapper="$jarvis_bin_dir/jarvis"
jarvis_desktop="$jarvis_apps_dir/jarvis.desktop"

case "$jarvis_source" in
  https://*)
    command -v curl >/dev/null || fail 'Do pobrania instalatora potrzebny jest curl.'
    printf 'Pobieram JARVIS-a…\n'
    curl --fail --location --retry 3 --connect-timeout 20 --proto '=https' --proto-redir '=https' \
      --output "$jarvis_work/JARVIS.AppImage" "$jarvis_source"
    ;;
  *://*) fail 'Adres pobrania musi używać HTTPS.' ;;
  *) [[ -f "$jarvis_source" ]] || fail 'Nie znaleziono wskazanego pliku AppImage.'
    cp -- "$jarvis_source" "$jarvis_work/JARVIS.AppImage" ;;
esac
[[ -s "$jarvis_work/JARVIS.AppImage" ]] || fail 'Pobrany plik jest pusty.'
if [[ -n "$jarvis_sha" ]]; then
  jarvis_actual=$(sha256sum "$jarvis_work/JARVIS.AppImage")
  [[ "${jarvis_actual%% *}" == "${jarvis_sha,,}" ]] || fail 'Suma SHA256 jest niezgodna. Dotychczasowa instalacja pozostaje bez zmian.'
  printf 'Suma SHA256 poprawna.\n'
else
  printf 'Nie podano sumy SHA256; źródło pliku musi być zaufane.\n' >&2
fi
chmod 755 "$jarvis_work/JARVIS.AppImage"
{
  printf '#!/usr/bin/env bash\nset -e\ncd -- '
  printf '%q' "$jarvis_install_dir"
  printf '\nexport APPIMAGE_EXTRACT_AND_RUN=1\nexec '
  printf '%q' "$jarvis_target"
  printf ' "$@"\n'
} > "$jarvis_work/jarvis"
chmod 755 "$jarvis_work/jarvis"

# Desktop Entry has two escaping layers: string values, then quoted Exec arguments.
desktop_quote() {
  local jarvis_value=$1
  jarvis_value=${jarvis_value//\\/\\\\\\\\}
  jarvis_value=${jarvis_value//\"/\\\\\"}
  jarvis_value=${jarvis_value//\`/\\\\\`}
  jarvis_value=${jarvis_value//\$/\\\\\$}
  jarvis_value=${jarvis_value//%/%%}
  printf '"%s"' "$jarvis_value"
}
{
  printf '[Desktop Entry]\nType=Application\nName=JARVIS\nComment=Asystent AI, rozmowa i kolejka zadań\nExec=/usr/bin/env '
  desktop_quote "$jarvis_wrapper"
  printf '\nIcon=applications-science\nTerminal=false\nCategories=Utility;\nStartupNotify=true\n'
} > "$jarvis_work/jarvis.desktop"
chmod 644 "$jarvis_work/jarvis.desktop"

jarvis_paths=("$jarvis_target" "$jarvis_wrapper" "$jarvis_desktop")
for jarvis_index in "${!jarvis_paths[@]}"; do
  jarvis_path=${jarvis_paths[$jarvis_index]}
  [[ ! -L "$jarvis_path" ]] || fail "Plik docelowy jest dowiązaniem symbolicznym: $jarvis_path"
  [[ ! -e "$jarvis_path" || -f "$jarvis_path" ]] || fail "Plik docelowy nie jest zwykłym plikiem: $jarvis_path"
  jarvis_backups[$jarvis_index]="$jarvis_work/backup-$jarvis_index"
  if [[ -f "$jarvis_path" ]]; then cp -p -- "$jarvis_path" "${jarvis_backups[$jarvis_index]}"; fi
done
# Keep the previous executable available even after a successful update.
if [[ -f "$jarvis_target" ]]; then
  cp -p -- "$jarvis_target" "$jarvis_work/previous.AppImage"
  mv -f -- "$jarvis_work/previous.AppImage" "$jarvis_install_dir/JARVIS.previous.AppImage"
fi
jarvis_changed=1
mv -f -- "$jarvis_work/JARVIS.AppImage" "$jarvis_target"
mv -f -- "$jarvis_work/jarvis" "$jarvis_wrapper"
mv -f -- "$jarvis_work/jarvis.desktop" "$jarvis_desktop"
jarvis_committed=1
if command -v update-desktop-database >/dev/null; then update-desktop-database "$jarvis_apps_dir" >/dev/null 2>&1 || true; fi
printf 'Zainstalowano JARVIS-a. Uruchomisz go z menu aplikacji lub poleceniem:\n  %q\n' "$jarvis_wrapper"
printf 'Nowy profil użyje domyślnych ustawień paczki. Istniejący profil i klucze API pozostają zachowane.\n'

if ((jarvis_launch)); then
  if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
    printf 'Brak sesji graficznej. Uruchom JARVIS-a z menu po zalogowaniu do pulpitu.\n'
  else
    jarvis_log="$jarvis_state_dir/launch.log"
    nohup "$jarvis_wrapper" >"$jarvis_log" 2>&1 < /dev/null &
    jarvis_pid=$!
    sleep 2
    if kill -0 "$jarvis_pid" 2>/dev/null; then
      printf 'JARVIS został uruchomiony.\n'
    else
      set +e
      wait "$jarvis_pid"
      jarvis_start_status=$?
      set -e
      if ((jarvis_start_status == 0)); then
        printf 'Polecenie uruchomienia zakończone; sprawdź okno JARVIS-a.\n'
      else
        printf 'Instalacja zakończona, ale uruchomienie zwróciło błąd %s. Szczegóły: %s\n' "$jarvis_start_status" "$jarvis_log" >&2
        exit "$jarvis_start_status"
      fi
    fi
  fi
fi
