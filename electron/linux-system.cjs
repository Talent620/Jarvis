// === Natywne sterowanie i diagnostyka systemu Linux (bez powłoki — execFile only) ===
// Zapewnia pełną parę funkcjonalną z Windows dla: zasilania, głośności (PipeWire/Pulse/ALSA),
// multimediów (MPRIS/playerctl), wykrywania GPU/VRAM, diagnostyki zależności (W1) i
// walidacji granic okna na wielu monitorach. Wszystkie wywołania systemu są wstrzykiwalne do testów.
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");

function defaultRun(cmd, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          code: err.code || "err",
          stdout: String(stdout || ""),
          stderr: String(stderr || err.message || ""),
        });
        return;
      }
      resolve({ ok: true, code: 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function runChain(candidates, runner = defaultRun) {
  let lastCode = "err:not-found";
  for (const [cmd, args] of candidates) {
    const res = await runner(cmd, args);
    if (res.ok) return "ok";
    if (res.code !== "ENOENT") lastCode = `err:${res.code}`;
  }
  return lastCode;
}

/** Zasilanie na Linuxie: lock | sleep | shutdown | restart | logoff. */
async function linuxPower(action, opts = {}) {
  const runner = opts.run || defaultRun;
  const user = opts.user || os.userInfo().username;
  const a = String(action || "").toLowerCase().trim();
  const chains = {
    lock: [
      ["loginctl", ["lock-session"]],
      ["xdg-screensaver", ["lock"]],
      ["gnome-screensaver-command", ["-l"]],
    ],
    sleep: [["systemctl", ["suspend"]]],
    shutdown: [["systemctl", ["poweroff"]]],
    restart: [["systemctl", ["reboot"]]],
    logoff: [
      ["gnome-session-quit", ["--logout", "--no-prompt"]],
      ["loginctl", ["terminate-user", user]],
    ],
  };
  const chain = chains[a];
  if (!chain) return "err:unknown";
  return runChain(chain, runner);
}

/** Głośność na Linuxie: up | down | mute | set:<0-100> (PipeWire wpctl → PulseAudio pactl → ALSA amixer). */
async function linuxVolume(action, opts = {}) {
  const runner = opts.run || defaultRun;
  const a = String(action || "").toLowerCase().trim();
  const setMatch = a.match(/^set:(\d{1,3})$/);
  if (setMatch) {
    const pct = Math.max(0, Math.min(100, Number(setMatch[1])));
    return runChain(
      [
        ["wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", `${pct}%`]],
        ["pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${pct}%`]],
        ["amixer", ["-q", "sset", "Master", `${pct}%`]],
      ],
      runner,
    );
  }
  const chains = {
    up: [
      ["wpctl", ["set-volume", "-l", "1.5", "@DEFAULT_AUDIO_SINK@", "5%+"]],
      ["pactl", ["set-sink-volume", "@DEFAULT_SINK@", "+5%"]],
      ["amixer", ["-q", "sset", "Master", "5%+"]],
    ],
    down: [
      ["wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", "5%-"]],
      ["pactl", ["set-sink-volume", "@DEFAULT_SINK@", "-5%"]],
      ["amixer", ["-q", "sset", "Master", "5%-"]],
    ],
    mute: [
      ["wpctl", ["set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"]],
      ["pactl", ["set-sink-mute", "@DEFAULT_SINK@", "toggle"]],
      ["amixer", ["-q", "sset", "Master", "toggle"]],
    ],
  };
  const chain = chains[a];
  if (!chain) return "err:unknown";
  return runChain(chain, runner);
}

/** Multimedia na Linuxie: playpause | play | pause | next | prev | previous | stop (playerctl → MPRIS D-Bus). */
async function linuxMedia(action, opts = {}) {
  const runner = opts.run || defaultRun;
  const a = String(action || "").toLowerCase().trim();
  const map = {
    playpause: ["play-pause", "PlayPause"],
    play: ["play", "Play"],
    pause: ["pause", "Pause"],
    next: ["next", "Next"],
    prev: ["previous", "Previous"],
    previous: ["previous", "Previous"],
    stop: ["stop", "Stop"],
  };
  const pair = map[a];
  if (!pair) return "err:unknown";
  const [pctlArg, mprisMethod] = pair;
  return runChain(
    [
      ["playerctl", [pctlArg]],
      [
        "dbus-send",
        [
          "--print-reply",
          "--dest=org.mpris.MediaPlayer2.spotify",
          "/org/mpris/MediaPlayer2",
          `org.mpris.MediaPlayer2.Player.${mprisMethod}`,
        ],
      ],
    ],
    runner,
  );
}

/** Wykryj rzeczywiste GPU i VRAM na Linuxie (nvidia-smi → sysfs AMD/DRM → lspci). */
async function detectLinuxGpu(opts = {}) {
  const runner = opts.run || defaultRun;
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, "utf8"));
  const readdir = opts.readdir || ((p) => fs.readdirSync(p));

  // 1) NVIDIA: dokładna nazwa i VRAM w MiB.
  const nv = await runner("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (nv.ok && nv.stdout.trim()) {
    const line = nv.stdout.trim().split(/\r?\n/)[0];
    const [nameRaw, memRaw] = line.split(",").map((x) => x.trim());
    const memMb = Number(memRaw);
    return {
      gpu: nameRaw || "NVIDIA GPU",
      vramGb: Number.isFinite(memMb) && memMb > 0 ? Math.round((memMb / 1024) * 10) / 10 : 0,
    };
  }

  // 2) AMD / DRM sysfs: mem_info_vram_total (bajty).
  try {
    const cards = readdir("/sys/class/drm").filter((n) => /^card\d+$/.test(n));
    for (const c of cards) {
      try {
        const bytes = Number(String(readFile(`/sys/class/drm/${c}/device/mem_info_vram_total`)).trim());
        if (Number.isFinite(bytes) && bytes > 0) {
          return { gpu: `DRM ${c}`, vramGb: Math.round((bytes / 1073741824) * 10) / 10 };
        }
      } catch {
        /* nie każdy sterownik wystawia mem_info_vram_total */
      }
    }
  } catch {
    /* brak /sys/class/drm */
  }

  // 3) Fallback: lspci (nazwa karty, VRAM nieznany → 0).
  const pci = await runner("lspci", []);
  if (pci.ok && pci.stdout) {
    const vga = pci.stdout
      .split(/\r?\n/)
      .find((l) => /VGA compatible controller|3D controller/i.test(l));
    if (vga) {
      const idx = vga.indexOf(": ");
      return { gpu: idx >= 0 ? vga.slice(idx + 2).trim() : vga.trim(), vramGb: 0 };
    }
  }
  return { gpu: "", vramGb: 0 };
}

/** Odczytaj nazwę dystrybucji z /etc/os-release (bez zgadywania). */
function readLinuxDistro(readFile = (p) => fs.readFileSync(p, "utf8")) {
  try {
    const raw = String(readFile("/etc/os-release"));
    const m = raw.match(/^PRETTY_NAME=(?:"([^"]+)"|(.+))$/m);
    return (m && (m[1] || m[2]) ? (m[1] || m[2]).trim() : "Linux");
  } catch {
    return "Linux";
  }
}

/**
 * W1 (JARVIS_REPAIR_PLAN): Jeden diagnostyczny status zależności systemu Linux.
 * Zwraca uczciwe stany: "available" | "missing" | "disabled" | "error" z akcją naprawczą dla Ubuntu.
 */
async function linuxDiagnostics(opts = {}) {
  const runner = opts.run || defaultRun;
  const env = opts.env || process.env;
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, "utf8"));
  const sessionType = env.XDG_SESSION_TYPE || (env.WAYLAND_DISPLAY ? "wayland" : env.DISPLAY ? "x11" : "headless");
  const distro = readLinuxDistro(readFile);
  const gpuInfo = await detectLinuxGpu({ run: runner, readFile, readdir: opts.readdir });

  const hasBin = async (cmd, args = ["--version"]) => {
    const r = await runner(cmd, args, 2500);
    return r.ok ? { ok: true, out: r.stdout.trim().split(/\r?\n/)[0] || "" } : { ok: false, code: r.code, err: r.stderr.trim() };
  };

  const items = [];

  // Audio (PipeWire / PulseAudio / ALSA)
  const wp = await hasBin("wpctl", ["--version"]);
  const pa = wp.ok ? wp : await hasBin("pactl", ["--version"]);
  const alsa = pa.ok ? pa : await hasBin("amixer", ["--version"]);
  items.push({
    id: "audio",
    label: "Sterowanie dźwiękiem (PipeWire/Pulse/ALSA)",
    status: wp.ok || pa.ok || alsa.ok ? "available" : "missing",
    detail: wp.ok ? "wpctl (PipeWire)" : pa.ok ? "pactl (PulseAudio)" : alsa.ok ? "amixer (ALSA)" : "Brak wpctl/pactl/amixer",
    ...(wp.ok || pa.ok || alsa.ok ? {} : { fixHint: "sudo apt install -y wireplumber pulseaudio-utils" }),
  });

  // Multimedia (MPRIS / playerctl)
  const pctl = await hasBin("playerctl", ["--version"]);
  items.push({
    id: "media",
    label: "Sterowanie multimediami (MPRIS)",
    status: pctl.ok ? "available" : "missing",
    detail: pctl.ok ? `playerctl ${pctl.out}` : "Brak playerctl (fallback D-Bus Spotify)",
    ...(pctl.ok ? {} : { fixHint: "sudo apt install -y playerctl" }),
  });

  // Klawiatura / mysz (X11 xdotool lub Wayland ydotool — spójne z desktop-doctor.cjs)
  if (sessionType === "wayland") {
    const ydo = await hasBin("ydotool", ["--help"]);
    items.push({
      id: "x11Input",
      label: "Automatyzacja klawiatury/myszy (Wayland)",
      status: ydo.ok ? "available" : "disabled",
      detail: ydo.ok
        ? "Sesja Wayland — aktywne sterowanie OMNI-PILOT przez ydotool (xdotool wymaga X11)."
        : "Sesja Wayland — xdotool wymaga X11; dla OMNI-PILOT na Wayland zainstaluj ydotool.",
      ...(ydo.ok ? {} : { fixHint: "sudo apt install -y ydotool ydotoold && sudo systemctl enable --now ydotoold" }),
    });
  } else {
    const xdo = await hasBin("xdotool", ["version"]);
    items.push({
      id: "x11Input",
      label: "Automatyzacja klawiatury/myszy (X11)",
      status: xdo.ok ? "available" : "missing",
      detail: xdo.ok ? xdo.out || "xdotool dostępny" : "Brak xdotool",
      ...(xdo.ok ? {} : { fixHint: "sudo apt install -y xdotool" }),
    });
  }

  // Lokalna Ollama
  const oll = await hasBin("ollama", ["--version"]);
  items.push({
    id: "ollama",
    label: "Lokalne AI (Ollama)",
    status: oll.ok ? "available" : "missing",
    detail: oll.ok ? oll.out || "ollama zainstalowana" : "Brak lokalnego binarium ollama",
    ...(oll.ok ? {} : { fixHint: "curl -fsSL https://ollama.com/install.sh | sh" }),
  });

  // Docker (CLI + działający demon — nigdy nie kłamie, że aktywny, gdy demon nie odpowiada!)
  const dockCli = await hasBin("docker", ["--version"]);
  if (!dockCli.ok) {
    items.push({
      id: "docker",
      label: "Docker (opcjonalny)",
      status: "missing",
      detail: "Brak CLI docker (nie jest wymagany do pracy JARVIS-a).",
      fixHint: "sudo apt install -y docker.io",
    });
  } else {
    const dockInfo = await runner("docker", ["info", "--format", "{{.ServerVersion}}"], 2500);
    items.push({
      id: "docker",
      label: "Docker (opcjonalny)",
      status: dockInfo.ok ? "available" : "disabled",
      detail: dockInfo.ok ? `Demon Docker ${dockInfo.stdout.trim()}` : "CLI zainstalowane, ale demon Docker nie działa.",
      ...(dockInfo.ok ? {} : { fixHint: "sudo systemctl enable --now docker" }),
    });
  }

  // SQLite & PostgreSQL CLI (opcjonalne)
  const sq = await hasBin("sqlite3", ["--version"]);
  items.push({
    id: "sqlite3",
    label: "SQLite CLI (opcjonalne)",
    status: sq.ok ? "available" : "missing",
    detail: sq.ok ? sq.out : "Brak sqlite3 (JARVIS używa IndexedDB bez tego narzędzia).",
    ...(sq.ok ? {} : { fixHint: "sudo apt install -y sqlite3" }),
  });

  const pg = await hasBin("psql", ["--version"]);
  items.push({
    id: "psql",
    label: "PostgreSQL CLI (opcjonalne)",
    status: pg.ok ? "available" : "missing",
    detail: pg.ok ? pg.out : "Brak psql.",
    ...(pg.ok ? {} : { fixHint: "sudo apt install -y postgresql-client" }),
  });

  return {
    ok: true,
    platform: "linux",
    distro,
    sessionType,
    gpu: gpuInfo.gpu,
    vramGb: gpuInfo.vramGb,
    items,
  };
}

/**
 * Walidacja zapisanych współrzędnych okna względem aktywnych ekranów.
 * Zapobiega otwarciu okna JARVIS-a poza widocznym monitorem po odłączeniu drugiego ekranu.
 */
function clampWindowBounds(saved, displays) {
  const def = { width: 1120, height: 820 };
  const w = Math.max(380, Math.min(Number(saved?.width) || def.width, 3840));
  const h = Math.max(560, Math.min(Number(saved?.height) || def.height, 2160));
  if (typeof saved?.x !== "number" || typeof saved?.y !== "number" || !Array.isArray(displays) || !displays.length) {
    return { width: w, height: h };
  }
  const visible = displays.some((d) => {
    const wa = d.workArea || d.bounds || d;
    if (!wa) return false;
    const overlapX = Math.min(saved.x + w, wa.x + wa.width) - Math.max(saved.x, wa.x);
    const overlapY = Math.min(saved.y + h, wa.y + wa.height) - Math.max(saved.y, wa.y);
    return overlapX >= 120 && overlapY >= 80;
  });
  return visible ? { width: w, height: h, x: saved.x, y: saved.y } : { width: w, height: h };
}

module.exports = {
  linuxPower,
  linuxVolume,
  linuxMedia,
  detectLinuxGpu,
  readLinuxDistro,
  linuxDiagnostics,
  clampWindowBounds,
};
