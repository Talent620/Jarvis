// === JARVIS OMNI-PILOT — Płynny aktuator pulpitu (Linux X11 / Wayland ydotool / Windows) ===
// Zapewnia ludzki, płynny ruch kursora (krzywa kubiczna ease-in-out), kliknięcia (lewy/prawy/podwójny/środkowy),
// przewijanie, przeciąganie (drag&drop), listę i przełączanie okien, wpisywanie UTF-8 (polskie znaki)
// oraz natychmiastowy sprzętowy kill-switch (abort). Zero wstrzykiwania powłoki (execFile/spawn shell:false).

const { execFile } = require("child_process");

function defaultRun(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs || 6000;
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, env: opts.env || process.env }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, code: err.code || "err", stdout: String(stdout || ""), stderr: String(stderr || err.message || "") });
        return;
      }
      resolve({ ok: true, code: 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pure: wygeneruj płynną trajektorię kursora (cubic ease-in-out z minimalnym organicznym łukiem),
 * żeby ruch myszy wyglądał naturalnie i widowiskowo zamiast nagłego teleportu.
 */
function computeSmoothPath(x0, y0, x1, y1, steps = 16) {
  const n = Math.max(1, Math.min(40, Math.round(steps)));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 4 || n === 1) return [{ x: Math.round(x1), y: Math.round(y1) }];
  // Delikatny, naturalny łuk (max 14 px), prostopadły do wektora ruchu
  const arc = Math.min(14, dist * 0.045);
  const nx = -dy / dist;
  const ny = dx / dist;
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    // Cubic ease-in-out
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const bend = Math.sin(Math.PI * t) * arc;
    pts.push({
      x: Math.round(x0 + dx * e + nx * bend),
      y: Math.round(y0 + dy * e + ny * bend),
    });
  }
  pts[pts.length - 1] = { x: Math.round(x1), y: Math.round(y1) };
  return pts;
}

/** Pure: zamień nazwany punkt ekranu (środek, rogi, pasek) na współrzędne pikselowe. */
function resolveNamedPoint(preset, width, height) {
  const w = Math.max(320, Number(width) || 1920);
  const h = Math.max(240, Number(height) || 1080);
  const p = String(preset || "").toLowerCase().trim();
  const map = {
    center: { x: Math.round(w * 0.5), y: Math.round(h * 0.5) },
    "top-left": { x: Math.round(w * 0.06), y: Math.round(h * 0.06) },
    "top-right": { x: Math.round(w * 0.94), y: Math.round(h * 0.06) },
    "bottom-left": { x: Math.round(w * 0.06), y: Math.round(h * 0.94) },
    "bottom-right": { x: Math.round(w * 0.94), y: Math.round(h * 0.94) },
    topbar: { x: Math.round(w * 0.5), y: Math.round(h * 0.025) },
    dock: { x: Math.round(w * 0.5), y: Math.round(h * 0.96) },
    left: { x: Math.round(w * 0.08), y: Math.round(h * 0.5) },
    right: { x: Math.round(w * 0.92), y: Math.round(h * 0.5) },
  };
  return map[p] || null;
}

/** Pure: ogranicz punkt do obszaru ekranu. */
function clampPoint(x, y, width, height) {
  const maxX = Math.max(0, (Number(width) || 1920) - 1);
  const maxY = Math.max(0, (Number(height) || 1080) - 1);
  return {
    x: Math.max(0, Math.min(maxX, Math.round(Number(x) || 0))),
    y: Math.max(0, Math.min(maxY, Math.round(Number(y) || 0))),
  };
}

function createDesktopPilot(deps = {}) {
  const platform = deps.platform || process.platform;
  const env = deps.env || process.env;
  const run = deps.run || defaultRun;
  const sleep = deps.sleep || defaultSleep;
  const getScreenSize = deps.getScreenSize || (() => ({ width: 1920, height: 1080 }));
  const getCursorPoint = deps.getCursorPoint || null;
  const clipboard = deps.clipboard || null;

  let abortSeq = 0;

  /** Natychmiastowe przerwanie każdego trwającego ruchu/akcji (kill-switch Ctrl+Alt+X). */
  function abort() {
    abortSeq++;
    return { ok: true, seq: abortSeq };
  }

  function isWayland() {
    return platform === "linux" && (env.XDG_SESSION_TYPE === "wayland" || (!!env.WAYLAND_DISPLAY && !env.DISPLAY));
  }

  async function cursorPosition() {
    if (getCursorPoint) {
      try {
        const pt = getCursorPoint();
        if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) return { ok: true, x: Math.round(pt.x), y: Math.round(pt.y) };
      } catch {
        /* fallback */
      }
    }
    if (platform === "linux" && !isWayland()) {
      const r = await run("xdotool", ["getmouselocation", "--shell"], { env });
      if (r.ok) {
        const mx = /^X=(-?\d+)/m.exec(r.stdout);
        const my = /^Y=(-?\d+)/m.exec(r.stdout);
        if (mx && my) return { ok: true, x: Number(mx[1]), y: Number(my[1]) };
      }
    }
    const sz = getScreenSize();
    return { ok: true, x: Math.round(sz.width / 2), y: Math.round(sz.height / 2), estimated: true };
  }

  /** Pojedynczy natychmiastowy skok kursora do (x, y) — bez powłoki. */
  async function setCursorRaw(x, y) {
    if (platform === "linux") {
      if (isWayland()) {
        const r = await run("ydotool", ["mousemove", "--absolute", "-x", String(x), "-y", String(y)], { env });
        return r.ok ? "ok" : r.code === "ENOENT" ? "err:wayland-ydotool-missing" : `err:${r.code}`;
      }
      const r = await run("xdotool", ["mousemove", "--sync", String(x), String(y)], { env });
      return r.ok ? "ok" : r.code === "ENOENT" ? "err:linux-xdotool-missing" : `err:${r.code}`;
    }
    if (platform === "win32") {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y})`;
      const r = await run("powershell", ["-NoProfile", "-Command", ps], { env });
      return r.ok ? "ok" : `err:${r.code}`;
    }
    return "err:unsupported";
  }

  /** Płynny ruch kursora z możliwością przerwania w każdym kroku. */
  async function glideTo(targetX, targetY, opts = {}) {
    const mySeq = abortSeq;
    const sz = getScreenSize();
    const dest = clampPoint(targetX, targetY, sz.width, sz.height);
    const smooth = opts.smooth !== false;
    if (!smooth) {
      const status = await setCursorRaw(dest.x, dest.y);
      return status === "ok" ? { ok: true, x: dest.x, y: dest.y } : { ok: false, error: status };
    }
    const start = await cursorPosition();
    const steps = opts.steps || 14;
    const stepDelayMs = opts.stepDelayMs ?? 10;
    const path = computeSmoothPath(start.x, start.y, dest.x, dest.y, steps);
    for (const pt of path) {
      if (mySeq !== abortSeq) return { ok: false, error: "err:aborted" };
      const status = await setCursorRaw(pt.x, pt.y);
      if (status !== "ok") return { ok: false, error: status };
      if (stepDelayMs > 0) await sleep(stepDelayMs);
    }
    return { ok: true, x: dest.x, y: dest.y };
  }

  /**
   * Przesuń kursor:
   *  - mode: "relative" (dx, dy)
   *  - mode: "absolute" (x, y)
   *  - mode: "named" (preset: center | top-left | top-right | bottom-left | bottom-right | dock | topbar)
   */
  async function moveCursor(payload = {}) {
    const sz = getScreenSize();
    const mode = String(payload.mode || "relative");
    const smooth = payload.smooth !== false;
    if (mode === "named") {
      const pt = resolveNamedPoint(payload.preset, sz.width, sz.height);
      if (!pt) return { ok: false, error: "err:unknown-preset" };
      return glideTo(pt.x, pt.y, { smooth, steps: payload.steps, stepDelayMs: payload.stepDelayMs });
    }
    if (mode === "absolute") {
      if (!Number.isFinite(Number(payload.x)) || !Number.isFinite(Number(payload.y))) {
        return { ok: false, error: "err:coordinates" };
      }
      return glideTo(Number(payload.x), Number(payload.y), { smooth, steps: payload.steps, stepDelayMs: payload.stepDelayMs });
    }
    // relative
    const dx = Number(payload.dx) || 0;
    const dy = Number(payload.dy) || 0;
    if (dx === 0 && dy === 0) return { ok: false, error: "err:empty-delta" };
    const start = await cursorPosition();
    return glideTo(start.x + dx, start.y + dy, { smooth, steps: payload.steps, stepDelayMs: payload.stepDelayMs });
  }

  /** Kliknięcie myszą (left | double | right | middle), opcjonalnie z płynnym dojazdem do (x, y). */
  async function mouseAction(payload = {}) {
    const mySeq = abortSeq;
    const action = String(payload.action || "click").toLowerCase();
    if (!["click", "left", "double", "right", "middle"].includes(action)) {
      return { ok: false, error: "err:unknown-action" };
    }
    if (payload.x !== undefined && payload.y !== undefined && Number.isFinite(Number(payload.x)) && Number.isFinite(Number(payload.y))) {
      const mv = await glideTo(Number(payload.x), Number(payload.y), { smooth: payload.smooth !== false, steps: payload.steps, stepDelayMs: payload.stepDelayMs });
      if (!mv.ok) return mv;
    }
    if (mySeq !== abortSeq) return { ok: false, error: "err:aborted" };

    if (platform === "linux") {
      if (isWayland()) {
        const codeMap = { click: ["0xC0"], left: ["0xC0"], double: ["--repeat", "2", "0xC0"], right: ["0xC1"], middle: ["0xC2"] };
        const r = await run("ydotool", ["click", ...codeMap[action]], { env });
        return r.ok ? { ok: true, action } : { ok: false, error: r.code === "ENOENT" ? "err:wayland-ydotool-missing" : `err:${r.code}` };
      }
      const xdoMap = {
        click: ["click", "1"],
        left: ["click", "1"],
        double: ["click", "--repeat", "2", "--delay", "70", "1"],
        right: ["click", "3"],
        middle: ["click", "2"],
      };
      const r = await run("xdotool", xdoMap[action], { env });
      return r.ok ? { ok: true, action } : { ok: false, error: r.code === "ENOENT" ? "err:linux-xdotool-missing" : `err:${r.code}` };
    }
    if (platform === "win32") {
      const flags =
        action === "right" ? "0x08,0,0,0,0); [M]::mouse_event(0x10,0,0,0,0)"
          : action === "middle" ? "0x20,0,0,0,0); [M]::mouse_event(0x40,0,0,0,0)"
            : action === "double" ? "0x02,0,0,0,0); [M]::mouse_event(0x04,0,0,0,0); Start-Sleep -Milliseconds 60; [M]::mouse_event(0x02,0,0,0,0); [M]::mouse_event(0x04,0,0,0,0)"
              : "0x02,0,0,0,0); [M]::mouse_event(0x04,0,0,0,0)";
      const ps = `Add-Type -Name M -Namespace J -MemberDefinition '[DllImport("user32.dll")]public static extern void mouse_event(int f,int x,int y,int d,int e);'; [J.M]::mouse_event(${flags}`;
      const r = await run("powershell", ["-NoProfile", "-Command", ps], { env });
      return r.ok ? { ok: true, action } : { ok: false, error: `err:${r.code}` };
    }
    return { ok: false, error: "err:unsupported" };
  }

  /** Przewijanie kółkiem myszy: up | down | left | right, amount 1..20. */
  async function scroll(payload = {}) {
    const dir = String(payload.direction || "down").toLowerCase();
    const amount = Math.max(1, Math.min(20, Math.round(Number(payload.amount) || 5)));
    if (!["up", "down", "left", "right"].includes(dir)) return { ok: false, error: "err:unknown-direction" };
    if (platform === "linux") {
      if (isWayland()) {
        const yDelta = dir === "up" ? amount : dir === "down" ? -amount : 0;
        const xDelta = dir === "right" ? amount : dir === "left" ? -amount : 0;
        const r = await run("ydotool", ["mousemove", "-w", "--", String(xDelta), String(yDelta)], { env });
        return r.ok ? { ok: true, direction: dir, amount } : { ok: false, error: r.code === "ENOENT" ? "err:wayland-ydotool-missing" : `err:${r.code}` };
      }
      const btn = { up: "4", down: "5", left: "6", right: "7" }[dir];
      const r = await run("xdotool", ["click", "--repeat", String(amount), "--delay", "25", btn], { env });
      return r.ok ? { ok: true, direction: dir, amount } : { ok: false, error: r.code === "ENOENT" ? "err:linux-xdotool-missing" : `err:${r.code}` };
    }
    if (platform === "win32") {
      const wheel = (dir === "up" ? 120 : -120) * amount;
      const ps = `Add-Type -Name M -Namespace J -MemberDefinition '[DllImport("user32.dll")]public static extern void mouse_event(int f,int x,int y,int d,int e);'; [J.M]::mouse_event(0x0800,0,0,${wheel},0)`;
      const r = await run("powershell", ["-NoProfile", "-Command", ps], { env });
      return r.ok ? { ok: true, direction: dir, amount } : { ok: false, error: `err:${r.code}` };
    }
    return { ok: false, error: "err:unsupported" };
  }

  /** Płynne przeciągnięcie elementu (drag & drop) z (x1, y1) do (x2, y2). */
  async function drag(payload = {}) {
    const mySeq = abortSeq;
    const x1 = Number(payload.x1);
    const y1 = Number(payload.y1);
    const x2 = Number(payload.x2);
    const y2 = Number(payload.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return { ok: false, error: "err:coordinates" };
    if (platform !== "linux" || isWayland()) return { ok: false, error: "err:unsupported" };
    const start = await glideTo(x1, y1, { smooth: true, steps: 8, stepDelayMs: payload.stepDelayMs });
    if (!start.ok) return start;
    const down = await run("xdotool", ["mousedown", "1"], { env });
    if (!down.ok) return { ok: false, error: `err:${down.code}` };
    try {
      const move = await glideTo(x2, y2, { smooth: true, steps: 14, stepDelayMs: payload.stepDelayMs ?? 12 });
      if (!move.ok || mySeq !== abortSeq) return { ok: false, error: "err:aborted" };
      return { ok: true, from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
    } finally {
      await run("xdotool", ["mouseup", "1"], { env });
    }
  }

  /** Lista widocznych okien pulpitu (Linux wmctrl/xdotool lub Windows Get-Process). */
  async function listWindows() {
    if (platform === "linux") {
      // wmctrl -l zwraca: 0x03200007  0 hostname Tytuł okna
      const wm = await run("wmctrl", ["-l"], { env });
      if (wm.ok && wm.stdout.trim()) {
        const windows = wm.stdout
          .trim()
          .split(/\r?\n/)
          .map((line) => {
            const m = line.match(/^(\S+)\s+(-?\d+)\s+\S+\s+(.+)$/);
            return m ? { id: m[1], title: m[3].trim() } : null;
          })
          .filter((x) => x && x.title);
        return { ok: true, windows: windows.slice(0, 40) };
      }
      if (!isWayland()) {
        const srch = await run("xdotool", ["search", "--onlyvisible", "--name", "."], { env });
        if (srch.ok) {
          const ids = srch.stdout.trim().split(/\r?\n/).filter((id) => /^\d+$/.test(id)).slice(0, 25);
          const windows = [];
          for (const id of ids) {
            const nm = await run("xdotool", ["getwindowname", id], { env });
            if (nm.ok && nm.stdout.trim()) windows.push({ id, title: nm.stdout.trim() });
          }
          return { ok: true, windows };
        }
      }
      return { ok: false, windows: [], error: isWayland() ? "err:wayland-window-list" : "err:linux-xdotool-missing" };
    }
    if (platform === "win32") {
      const ps = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 30 Id,MainWindowTitle | ConvertTo-Json -Compress`;
      const r = await run("powershell", ["-NoProfile", "-Command", ps], { env });
      if (!r.ok) return { ok: false, windows: [], error: `err:${r.code}` };
      try {
        const parsed = JSON.parse(r.stdout || "[]");
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        return { ok: true, windows: arr.map((x) => ({ id: String(x.Id), title: String(x.MainWindowTitle || "") })).filter((x) => x.title) };
      } catch {
        return { ok: true, windows: [] };
      }
    }
    return { ok: false, windows: [], error: "err:unsupported" };
  }

  /** Przełącz fokus na okno pasujące do zapytania (np. "firefox", "code", "terminal"). */
  async function focusWindow(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return { ok: false, error: "err:empty" };
    const listed = await listWindows();
    if (!listed.ok) return { ok: false, error: listed.error };
    const hit = listed.windows.find((w) => w.title.toLowerCase().includes(q));
    if (!hit) return { ok: false, error: "err:window-not-found" };
    if (platform === "linux") {
      const wm = await run("wmctrl", ["-ia", hit.id], { env });
      if (wm.ok) return { ok: true, window: hit };
      const xdo = await run("xdotool", ["windowactivate", "--sync", hit.id], { env });
      return xdo.ok ? { ok: true, window: hit } : { ok: false, error: `err:${xdo.code}` };
    }
    if (platform === "win32") {
      const b64 = Buffer.from(hit.title, "utf8").toString("base64");
      const ps = `$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); (New-Object -ComObject WScript.Shell).AppActivate($t) | Out-Null`;
      const r = await run("powershell", ["-NoProfile", "-Command", ps], { env });
      return r.ok ? { ok: true, window: hit } : { ok: false, error: `err:${r.code}` };
    }
    return { ok: false, error: "err:unsupported" };
  }

  /** Wpisz tekst z pełnym wsparciem UTF-8 (polskie znaki ą/ć/ę/ł/ń/ó/ś/ź/ż) przez bezpieczny schowek + Ctrl+V (z przywróceniem schowka). */
  async function typeUnicode(text) {
    const s = String(text || "");
    if (!s || s.length > 4000) return { ok: false, error: "err:invalid-text" };
    if (clipboard) {
      const prev = clipboard.readText ? clipboard.readText() : "";
      clipboard.writeText(s);
      let pasteRes;
      if (platform === "linux") {
        pasteRes = isWayland()
          ? await run("ydotool", ["key", "29:1", "47:1", "47:0", "29:0"], { env })
          : await run("xdotool", ["key", "--clearmodifiers", "ctrl+v"], { env });
      } else if (platform === "win32") {
        const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')`;
        pasteRes = await run("powershell", ["-NoProfile", "-Command", ps], { env });
      } else {
        return { ok: false, error: "err:unsupported" };
      }
      await sleep(120);
      try { if (clipboard.writeText) clipboard.writeText(prev); } catch { /* ignore */ }
      return pasteRes.ok ? { ok: true, chars: s.length } : { ok: false, error: `err:${pasteRes.code}` };
    }
    if (platform === "linux" && !isWayland()) {
      const r = await run("xdotool", ["type", "--clearmodifiers", "--delay", "12", "--", s], { env });
      return r.ok ? { ok: true, chars: s.length } : { ok: false, error: r.code === "ENOENT" ? "err:linux-xdotool-missing" : `err:${r.code}` };
    }
    return { ok: false, error: "err:unsupported" };
  }

  /** Naciśnij globalny skrót klawiszowy bez wymogu ręcznego podawania tytułu (do refleksu głosowego). */
  async function globalHotkey(combo) {
    const c = String(combo || "").toLowerCase().trim();
    const allowed = new Set([
      "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+z", "ctrl+y", "ctrl+shift+z", "ctrl+s", "ctrl+a",
      "ctrl+t", "ctrl+w", "ctrl+tab", "ctrl+shift+tab", "ctrl+f", "ctrl+l", "ctrl+r",
      "alt+tab", "alt+left", "alt+right", "enter", "escape", "tab", "space", "backspace", "f5", "f11",
    ]);
    if (!allowed.has(c)) return { ok: false, error: "err:hotkey-not-allowed" };
    if (platform === "linux" && !isWayland()) {
      const xdoKey = c
        .replace(/\benter\b/, "Return")
        .replace(/\bescape\b/, "Escape")
        .replace(/\bspace\b/, "space")
        .replace(/\bbackspace\b/, "BackSpace")
        .replace(/\btab\b/, "Tab")
        .replace(/\bleft\b/, "Left")
        .replace(/\bright\b/, "Right")
        .replace(/\bf5\b/, "F5")
        .replace(/\bf11\b/, "F11");
      const r = await run("xdotool", ["key", "--clearmodifiers", xdoKey], { env });
      return r.ok ? { ok: true, combo: c } : { ok: false, error: r.code === "ENOENT" ? "err:linux-xdotool-missing" : `err:${r.code}` };
    }
    if (platform === "win32") {
      const sk = c
        .replace("ctrl+", "^")
        .replace("alt+", "%")
        .replace("shift+", "+")
        .replace("enter", "{ENTER}")
        .replace("escape", "{ESC}")
        .replace("tab", "{TAB}")
        .replace("backspace", "{BACKSPACE}")
        .replace("f5", "{F5}")
        .replace("f11", "{F11}");
      const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sk}')`;
      const r = await run("powershell", ["-NoProfile", "-Command", ps], { env });
      return r.ok ? { ok: true, combo: c } : { ok: false, error: `err:${r.code}` };
    }
    return { ok: false, error: isWayland() ? "err:wayland-hotkey-unsupported" : "err:unsupported" };
  }

  return {
    abort,
    cursorPosition,
    moveCursor,
    mouseAction,
    scroll,
    drag,
    listWindows,
    focusWindow,
    typeUnicode,
    globalHotkey,
  };
}

module.exports = {
  createDesktopPilot,
  computeSmoothPath,
  resolveNamedPoint,
  clampPoint,
};
