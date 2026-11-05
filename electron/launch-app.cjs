// Launch without a shell; a spawn event proves only that a process started, not that a window opened.
const { spawn } = require("child_process");
const os = require("os");

const linuxApps = {
  kalkulator: [["gnome-calculator"], ["kcalc"], ["xcalc"]],
  calculator: [["gnome-calculator"], ["kcalc"], ["xcalc"]],
  calc: [["gnome-calculator"], ["kcalc"], ["xcalc"]],
  przeglądarka: [["firefox"], ["google-chrome"], ["chromium"]],
  przegladarka: [["firefox"], ["google-chrome"], ["chromium"]],
  browser: [["firefox"], ["google-chrome"], ["chromium"]],
  chrome: [["google-chrome"], ["chromium"]],
  firefox: [["firefox"]],
  pliki: [["xdg-open", os.homedir()]],
  files: [["xdg-open", os.homedir()]],
  eksplorator: [["xdg-open", os.homedir()]],
  notatnik: [["gnome-text-editor"], ["gedit"], ["mousepad"]],
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
