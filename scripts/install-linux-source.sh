#!/usr/bin/env bash
# Build the selected JARVIS revision and install its AppImage for the current user.
set -Eeuo pipefail
umask 077

jarvis_repo="${JARVIS_SOURCE_REPO:-Talent620/Jarvis}"
jarvis_ref="${JARVIS_SOURCE_REF:-codex/linux-pro-new-20261105}"
jarvis_no_launch=0
jarvis_work=""
usage() {
  cat <<'HELP'
Użycie: bash install-linux-source.sh [--no-launch]
Pobiera źródła, instaluje brakujące zależności, buduje i uruchamia JARVIS-a.
Linux x86_64: Ubuntu, Debian, Linux Mint i zgodne pochodne z apt-get.
JARVIS_SOURCE_REF wybiera gałąź/tag/commit; JARVIS_SOURCE_REPO wybiera repozytorium.
Instalacja aplikacji jest per-user. sudo jest używane tylko dla brakujących pakietów systemowych.
HELP
}
fail() { printf 'JARVIS: %s\n' "$*" >&2; exit 1; }
for jarvis_arg in "$@"; do
  case "$jarvis_arg" in --no-launch) jarvis_no_launch=1 ;; --help|-h) usage; exit 0 ;; *) fail "Nieznana opcja: $jarvis_arg" ;; esac
done
[[ $(uname -s) == Linux ]] || fail 'Instalator wymaga Linuksa.'
case "$(uname -m)" in x86_64|amd64) ;; *) fail 'Ta instalacja jest przeznaczona dla x86_64 (AMD/Intel 64-bit).' ;; esac
((EUID != 0)) || fail 'Uruchom tę komendę jako zwykły użytkownik, bez sudo przed całym instalatorem.'
[[ "$jarvis_repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'Nieprawidłowa nazwa repozytorium.'
[[ "$jarvis_ref" =~ ^[A-Za-z0-9_./-]+$ && "$jarvis_ref" != -* ]] || fail 'Nieprawidłowa gałąź/tag/commit.'
[[ -r /etc/os-release ]] || fail 'Nie rozpoznano dystrybucji Linuksa.'
# Standard, system-owned distribution metadata; no user configuration is sourced.
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
  *' ubuntu '*|*' debian '*|*' linuxmint '*) ;;
  *) fail 'Automatyczna budowa obsługuje Ubuntu/Debian/Mint. Dla innej dystrybucji użyj gotowego AppImage.' ;;
esac
command -v apt-get >/dev/null || fail 'Brak apt-get; użyj gotowego AppImage dla swojej dystrybucji.'

cleanup() {
  local jarvis_status=$?
  trap - EXIT INT TERM
  [[ -z "$jarvis_work" ]] || rm -rf -- "$jarvis_work"
  if ((jarvis_status != 0)); then printf 'Instalacja nie została ukończona. Sprawdź komunikat błędu powyżej; dane aplikacji nie były resetowane.\n' >&2; fi
  exit "$jarvis_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
jarvis_work=$(mktemp -d "${TMPDIR:-/tmp}/jarvis-source.XXXXXXXX")

is_installed() { [[ $(dpkg-query -W -f='${Status}' "$1" 2>/dev/null || true) == 'install ok installed' ]]; }
jarvis_groups=(ca-certificates curl git build-essential python3 xz-utils
  'libgtk-3-0t64:libgtk-3-0' libnotify4 libnss3 libxss1 libxtst6
  'libatspi2.0-0t64:libatspi2.0-0' libuuid1 'libasound2t64:libasound2'
  libgbm1 libdrm2 libx11-xcb1 xdg-utils)
jarvis_missing=()
for jarvis_group in "${jarvis_groups[@]}"; do
  IFS=: read -r -a jarvis_choices <<< "$jarvis_group"
  jarvis_found=0
  for jarvis_package in "${jarvis_choices[@]}"; do if is_installed "$jarvis_package"; then jarvis_found=1; break; fi; done
  ((jarvis_found)) || jarvis_missing+=("$jarvis_group")
done
if ((${#jarvis_missing[@]})); then
  command -v sudo >/dev/null || fail 'Brakuje sudo do instalacji zależności systemowych. Poproś administratora o ich instalację.'
  printf '\n[1/5] Instaluję brakujące biblioteki i narzędzia systemowe. sudo może poprosić o Twoje hasło.\n'
  sudo apt-get update
  jarvis_packages=()
  for jarvis_group in "${jarvis_missing[@]}"; do
    IFS=: read -r -a jarvis_choices <<< "$jarvis_group"
    jarvis_selected=""
    for jarvis_package in "${jarvis_choices[@]}"; do
      jarvis_candidate=$(LC_ALL=C apt-cache policy "$jarvis_package" 2>/dev/null | awk '/Candidate:/{print $2; exit}')
      if [[ -n "$jarvis_candidate" && "$jarvis_candidate" != '(none)' ]]; then jarvis_selected=$jarvis_package; break; fi
    done
    [[ -n "$jarvis_selected" ]] || fail "Repozytoria systemu nie udostępniają pakietu: $jarvis_group. Sprawdź wersję dystrybucji i źródła apt."
    jarvis_packages+=("$jarvis_selected")
  done
  sudo apt-get install -y "${jarvis_packages[@]}"
else
  printf '\n[1/5] Biblioteki systemowe są zainstalowane.\n'
fi

fetch() {
  curl --fail --location --retry 3 --connect-timeout 20 --proto '=https' --proto-redir '=https' --output "$2" "$1"
}
jarvis_node_major=0
if command -v node >/dev/null && command -v npm >/dev/null; then
  jarvis_node_major=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')
fi
if [[ ! "$jarvis_node_major" =~ ^[0-9]+$ ]] || ((jarvis_node_major < 20)); then
  printf '\n[2/5] Pobieram oficjalny Node.js 22 LTS dla użytkownika.\n'
  fetch 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' "$jarvis_work/node-sha256.txt"
  read -r jarvis_node_sha jarvis_node_file < <(awk '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ { print $1, $2; exit }' "$jarvis_work/node-sha256.txt") || fail 'Nie znaleziono Node.js 22 Linux x64 w oficjalnym wykazie.'
  [[ "${jarvis_node_sha:-}" =~ ^[[:xdigit:]]{64}$ && "${jarvis_node_file:-}" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]] || fail 'Nie udało się odczytać oficjalnej sumy Node.js.'
  jarvis_node_dir="${XDG_DATA_HOME:-$HOME/.local/share}/jarvis/toolchains/${jarvis_node_file%.tar.xz}"
  if [[ ! -x "$jarvis_node_dir/bin/node" || ! -x "$jarvis_node_dir/bin/npm" ]]; then
    [[ ! -e "$jarvis_node_dir" ]] || fail "Niekompletna instalacja Node.js: $jarvis_node_dir"
    fetch "https://nodejs.org/dist/latest-v22.x/$jarvis_node_file" "$jarvis_work/node.tar.xz"
    jarvis_actual=$(sha256sum "$jarvis_work/node.tar.xz")
    [[ "${jarvis_actual%% *}" == "${jarvis_node_sha,,}" ]] || fail 'Suma pobranego Node.js jest niezgodna.'
    mkdir -p "$jarvis_work/node" "$(dirname "$jarvis_node_dir")"
    tar -xJf "$jarvis_work/node.tar.xz" --strip-components=1 --no-same-owner -C "$jarvis_work/node"
    mv -- "$jarvis_work/node" "$jarvis_node_dir"
  fi
  export PATH="$jarvis_node_dir/bin:$PATH"
  node --version
else
  printf '\n[2/5] Korzystam z Node.js %s.\n' "$(node --version)"
fi

printf '\n[3/5] Pobieram JARVIS: %s / %s.\n' "$jarvis_repo" "$jarvis_ref"
fetch "https://codeload.github.com/$jarvis_repo/tar.gz/$jarvis_ref" "$jarvis_work/source.tar.gz"
mkdir "$jarvis_work/source"
tar -xzf "$jarvis_work/source.tar.gz" --strip-components=1 --no-same-owner -C "$jarvis_work/source"
cd "$jarvis_work/source"
[[ -f package-lock.json && -f scripts/install-linux.sh && -f electron-builder.json ]] || fail 'Pobrana wersja nie zawiera kompletnego instalatora JARVIS-a.'
printf '\n[4/5] Instaluję zależności i buduję aplikację. Pierwsza instalacja może potrwać kilka minut.\n'
env -u ELECTRON_SKIP_BINARY_DOWNLOAD npm ci --no-audit --no-fund
JARVIS_LICENSE_REQUIRED=false npm run build
node node_modules/electron-builder/cli.js --linux AppImage --publish never
[[ -s release-desktop/JARVIS.AppImage ]] || fail 'Budowanie nie utworzyło AppImage.'
jarvis_app_sha=$(sha256sum release-desktop/JARVIS.AppImage)
jarvis_install_args=(--sha256 "${jarvis_app_sha%% *}")
((jarvis_no_launch == 0)) || jarvis_install_args+=(--no-launch)
printf '\n[5/5] Instaluję aplikację i skrót w menu.\n'
env -u JARVIS_INSTALL_URL -u JARVIS_INSTALL_SHA256 bash scripts/install-linux.sh "${jarvis_install_args[@]}" "$PWD/release-desktop/JARVIS.AppImage"
printf '\nGotowe. Nowy profil: PRO NEW, Indygo, automatyczna kolejka, pogłębiona analiza i weryfikacja.\n'
printf 'Istniejące ustawienia pozostają zachowane. Model AI i integracje podłączysz w Ustawieniach JARVIS-a.\n'
