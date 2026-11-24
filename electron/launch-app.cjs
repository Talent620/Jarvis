// Launch without a shell; a spawn event proves only that a process started, not that a window opened.
const { spawn } = require("child_process");
const os = require("os");

const linuxApps = {
  kalkulator: [["gnome-calculator"], ["kcalc"], ["qalculate-gtk"], ["xcalc"]],
  calculator: [["gnome-calculator"], ["kcalc"], ["qalculate-gtk"], ["xcalc"]],
  calc: [["gnome-calculator"], ["kcalc"], ["qalculate-gtk"], ["xcalc"]],
  przeglądarka: [["firefox"], ["google-chrome"], ["chromium"], ["brave-browser"]],
  przegladarka: [["firefox"], ["google-chrome"], ["chromium"], ["brave-browser"]],
  browser: [["firefox"], ["google-chrome"], ["chromium"], ["brave-browser"]],
  chrome: [["google-chrome"], ["chromium"], ["chromium-browser"]],
  firefox: [["firefox"]],
  pliki: [["xdg-open", os.homedir()]],
  files: [["xdg-open", os.homedir()]],
  eksplorator: [["xdg-open", os.homedir()]],
  notatnik: [["gnome-text-editor"], ["gedit"], ["kate"], ["mousepad"]],
  notepad: [["gnome-text-editor"], ["gedit"], ["kate"], ["mousepad"]],
  terminal: [["gnome-terminal"], ["konsole"], ["xfce4-terminal"], ["alacritty"], ["kitty"], ["x-terminal-emulator"]],
  konsola: [["gnome-terminal"], ["konsole"], ["xfce4-terminal"], ["x-terminal-emulator"]],
  code: [["code"], ["codium"]],
  vscode: [["code"], ["codium"]],
  spotify: [["spotify"], ["flatpak", "run", "com.spotify.Client"]],
  discord: [["discord"], ["flatpak", "run", "com.discordapp.Discord"]],
  telegram: [["telegram-desktop"], ["flatpak", "run", "org.telegram.desktop"]],
  ustawienia: [["gnome-control-center"], ["systemsettings"], ["xfce4-settings-manager"]],
  settings: [["gnome-control-center"], ["systemsettings"], ["xfce4-settings-manager"]],
  monitor: [["gnome-system-monitor"], ["plasma-systemmonitor"], ["ksysguard"]],
  menedzer: [["gnome-system-monitor"], ["plasma-systemmonitor"], ["ksysguard"]],
  task: [["gnome-system-monitor"], ["plasma-systemmonitor"], ["ksysguard"]],
  gimp: [["gimp"]],
  vlc: [["vlc"]],
  obsidian: [["obsidian"], ["flatpak", "run", "md.obsidian.Obsidian"]],
  writer: [["libreoffice", "--writer"]],
  word: [["libreoffice", "--writer"]],
  excel: [["libreoffice", "--calc"]],
  libreoffice: [["libreoffice"]],
};

function spawnStarted(command, args) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(command, args, { detached: true, stdio: "ignore" }); }
    catch (err) { resolve({ ok: false, code: err.code || "spawn" }); return; }
    child.once("error", (err) => resolve({ ok: false, code: err.code || "spawn" }));
    child.once("spawn", () => { child.unref(); resolve({ ok: true }); });
  });
}

async function launchLinux(name) {
  const raw = String(name || "").trim();
  const key = raw.toLowerCase();
  if (!raw) return "err:empty";
  // Unknown input is a single executable name or path, never a command line or shell.
  const candidates = linuxApps[key] || (/^[\w./-]+$/.test(raw) ? [[raw]] : []);
  if (!candidates.length) return "err:unknown";
  for (const [command, ...args] of candidates) {
    const result = await spawnStarted(command, args);
    if (result.ok) return "ok";
    if (result.code !== "ENOENT") return `err:${result.code}`;
  }
  return "err:not-found";
}

module.exports = { launchLinux };
