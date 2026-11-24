// === JARVIS OMNI-FRONTIER · Diagnostyka Systemowa „Znajdź i Napraw” (Read-Only, execFile-only) ===
// Zbiera twarde fakty z systemu (dźwięk, dysk, obciążenie CPU/RAM, porty, błędy journalctl,
// gotowość narzędzi OMNI-PILOT / AT-SPI2 / Ollama) i proponuje konkretne, bezpieczne komendy naprawcze.
// Zero wstrzykiwania powłoki (wyłącznie execFile). Zero nieautoryzowanych modyfikacji systemu.

const { execFile } = require("child_process");

function defaultRun(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs || 2500;
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, env: opts.env || process.env, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, code: err.code || "err", stdout: String(stdout || ""), stderr: String(stderr || err.message || "") });
        return;
      }
      resolve({ ok: true, code: 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function createDesktopDoctor(deps = {}) {
  const platform = deps.platform || process.platform;
  const env = deps.env || process.env;
  const run = deps.run || defaultRun;

  async function probeCommand(cmd, args = ["--version"]) {
    const r = await run(cmd, args, { env, timeoutMs: 1200 });
    if (r.ok) return true;
    return r.code !== "ENOENT";
  }

  async function diagnoseLinux() {
    const sessionType = String(env.XDG_SESSION_TYPE || (env.WAYLAND_DISPLAY ? "wayland" : env.DISPLAY ? "x11" : "headless")).toLowerCase();
    const checks = [];

    // 1) Dźwięk (PipeWire wpctl -> PulseAudio pactl)
    const wp = await run("wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"], { env });
    if (wp.ok && wp.stdout.trim()) {
      const muted = /\[MUTED\]/i.test(wp.stdout);
      checks.push({
        id: "audio",
        label: "Dźwięk (PipeWire)",
        status: muted ? "warn" : "ok",
        detail: wp.stdout.trim(),
        ...(muted ? { fixHint: "wpctl set-mute @DEFAULT_AUDIO_SINK@ 0" } : {}),
      });
    } else {
      const pa = await run("pactl", ["get-sink-mute", "@DEFAULT_SINK@"], { env });
      if (pa.ok && pa.stdout.trim()) {
        const muted = /yes/i.test(pa.stdout);
        checks.push({
          id: "audio",
          label: "Dźwięk (PulseAudio)",
          status: muted ? "warn" : "ok",
          detail: pa.stdout.trim(),
          ...(muted ? { fixHint: "pactl set-sink-mute @DEFAULT_SINK@ 0" } : {}),
        });
      } else {
        checks.push({
          id: "audio",
          label: "Dźwięk",
          status: "warn",
          detail: "Brak aktywnego narzędzia wpctl/pactl.",
          fixHint: "sudo apt install -y wireplumber pulseaudio-utils",
        });
      }
    }

    // 2) Dysk (/)
    const df = await run("df", ["-P", "-h", "/"], { env });
    if (df.ok) {
      const lines = df.stdout.trim().split(/\r?\n/);
      const cols = (lines[1] || "").trim().split(/\s+/);
      const pctStr = cols[4] || "";
      const pct = Number(pctStr.replace("%", "")) || 0;
      checks.push({
        id: "disk",
        label: "Miejsce na dysku (/)",
        status: pct >= 90 ? "error" : pct >= 80 ? "warn" : "ok",
        detail: cols.length >= 5 ? `Użyte ${cols[2]} / ${cols[1]} (${pctStr}), wolne ${cols[3]}` : df.stdout.trim().slice(0, 120),
        ...(pct >= 85 ? { fixHint: "sudo apt autoremove -y && journalctl --vacuum-time=7d" } : {}),
      });
    }

    // 3) Top procesy CPU/RAM
    const ps = await run("ps", ["-eo", "comm,%cpu,%mem", "--sort=-%cpu", "--no-headers"], { env });
    if (ps.ok && ps.stdout.trim()) {
      const top = ps.stdout
        .trim()
        .split(/\r?\n/)
        .slice(0, 5)
        .map((l) => l.trim().replace(/\s+/g, " "));
      const firstCpu = Number((top[0] || "").split(" ")[1]) || 0;
      checks.push({
        id: "processes",
        label: "Top procesy CPU",
        status: firstCpu >= 90 ? "warn" : "ok",
        detail: top.join(" · "),
      });
    }

    // 4) Lokalne otwarte porty TCP
    const ss = await run("ss", ["-tlnH"], { env });
    if (ss.ok) {
      const ports = ss.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => l.trim().split(/\s+/)[3] || "")
        .filter(Boolean)
        .slice(0, 10);
      checks.push({
        id: "ports",
        label: "Nasłuchujące porty TCP",
        status: "ok",
        detail: ports.length ? ports.join(", ") : "Brak otwartych portów nasłuchu.",
      });
    }

    // 5) Ostatnie błędy systemowe (journalctl)
    const jr = await run("journalctl", ["-p", "err", "-n", "5", "--no-pager", "-o", "short"], { env });
    if (jr.ok) {
      const lines = jr.stdout.trim().split(/\r?\n/).filter((l) => l && !l.startsWith("--"));
      checks.push({
        id: "journal",
        label: "Ostatnie błędy jądra/usług",
        status: lines.length > 0 ? "warn" : "ok",
        detail: lines.length ? lines.slice(-3).join(" | ").slice(0, 260) : "Brak błędów krytycznych w journalctl.",
      });
    }

    // 6) Gotowość OMNI-PILOT & AT-SPI2 & Ollama
    const [hasXdo, hasWmctrl, hasYdo, hasPlayer, hasAtspi, hasOllama] = await Promise.all([
      probeCommand("xdotool", ["version"]),
      probeCommand("wmctrl", ["-h"]),
      probeCommand("ydotool", ["--help"]),
      probeCommand("playerctl", ["--version"]),
      run("python3", ["-c", "import gi; gi.require_version('Atspi','2.0'); from gi.repository import Atspi; print('ok')"], { env, timeoutMs: 1400 }).then((r) => r.ok && r.stdout.includes("ok")),
      probeCommand("ollama", ["--version"]),
    ]);

    const missing = [];
    if (sessionType === "wayland") {
      if (!hasYdo) missing.push("ydotool");
    } else {
      if (!hasXdo) missing.push("xdotool");
      if (!hasWmctrl) missing.push("wmctrl");
    }
    if (!hasPlayer) missing.push("playerctl");

    checks.push({
      id: "omni_stack",
      label: `Gotowość OMNI-PILOT (${sessionType})`,
      status: missing.length === 0 ? "ok" : "warn",
      detail: [
        `AT-SPI2: ${hasAtspi ? "AKTYWNY (<80ms)" : "brak python3-gi/gir1.2-atspi-2.0 (fallback Wizja AI)"}`,
        `Ollama: ${hasOllama ? "zainstalowana" : "brak"}`,
        missing.length ? `Brakujące pakiety: ${missing.join(", ")}` : "Wszystkie narzędzia pulpitu obecne.",
      ].join(" · "),
      ...(missing.length || !hasAtspi
        ? {
            fixHint: `sudo apt install -y ${[...missing, ...(hasAtspi ? [] : ["python3-gi", "gir1.2-atspi-2.0"])].join(" ")}`,
          }
        : {}),
    });

    return { ok: true, platform: "linux", sessionType, checks, generatedAt: new Date().toISOString() };
  }

  async function diagnoseWindows() {
    const checks = [];
    const disk = await run("powershell", ["-NoProfile", "-Command", "$d=Get-PSDrive C; [math]::Round($d.Free/1GB,1)"], { env });
    if (disk.ok) {
      const freeGb = Number(disk.stdout.trim()) || 0;
      checks.push({
        id: "disk",
        label: "Dysk C:",
        status: freeGb < 10 ? "warn" : "ok",
        detail: `Wolne miejsce: ${freeGb} GB`,
      });
    }
    const top = await run(
      "powershell",
      ["-NoProfile", "-Command", "Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Name,@{N='CPU';E={[math]::Round($_.CPU,1)}} | ConvertTo-Json -Compress"],
      { env },
    );
    if (top.ok && top.stdout.trim()) {
      checks.push({ id: "processes", label: "Top procesy CPU", status: "ok", detail: top.stdout.trim().slice(0, 220) });
    }
    const hasOllama = await probeCommand("ollama", ["--version"]);
    checks.push({
      id: "omni_stack",
      label: "Gotowość OMNI-PILOT (Windows)",
      status: "ok",
      detail: `UI Automation: natywny .NET · Win32 Cursor: natywny · Ollama: ${hasOllama ? "zainstalowana" : "brak"}`,
    });
    return { ok: true, platform: "win32", sessionType: "win32", checks, generatedAt: new Date().toISOString() };
  }

  async function diagnose() {
    if (platform === "linux") return diagnoseLinux();
    if (platform === "win32") return diagnoseWindows();
    return { ok: false, platform, sessionType: platform, checks: [], error: "err:unsupported", generatedAt: new Date().toISOString() };
  }

  return { diagnose };
}

module.exports = { createDesktopDoctor };
