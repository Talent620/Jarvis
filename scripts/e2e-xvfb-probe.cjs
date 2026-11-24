#!/usr/bin/env node
/**
 * JARVIS Live E2E Probe (Linux Xvfb + real xdotool + real Google Chrome CDP + live Vite).
 *
 * Weryfikuje produkcyjną integrację BEZ mockowania X11/xdotool/UI:
 *  1. Spójność X11 (desktop-pilot.cjs + linux-keyboard.cjs) na Xvfb :99 + realny ruch kursora.
 *  2. Flow A: „przesuń kursor w prawo” → realny skok +240 px + wspólny ślad w AuditLog i GuardianHistory.
 *  3. Flow B: „uruchom shutdown” → twarda blokada RiskGuard (0 wywołań launch) + ślad security w AuditLog/Guardian.
 *  4. Flow C: błąd HUD → start Strażnika Ekranu (brak kolizji starego BŁĄD) → natychmiastowy Kill-Switch „stop”.
 *  5. Flow D: „rozpocznij cel: audyt produkcyjny” → voiceCognition + agentPlanner + goalRuntime + resultVerifier LIVE w UI.
 *  6. Flow E: AutoCore w runtime przeglądarki (jednolity resolver TTS, Ollama VL visionRouting, niezerowy koszt usług pobocznych).
 *  7. Flow F: provider:"auto" + lokalna Ollama (0 kluczy chmury) → otwarcie LiveOverlay (OLLAMA (LOKALNY), brak fałszywej blokady) + 0 błędów CORS.
 *
 * Zwraca kod wyjścia 0 tylko przy 100% PASS wszystkich asercji (fail-fast).
 */
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
const WsClient = require(path.join(REPO, "node_modules/ws"));
const { createDesktopPilot } = require(path.join(REPO, "electron/desktop-pilot.cjs"));
const { createLinuxKeyboard } = require(path.join(REPO, "electron/linux-keyboard.cjs"));
const { createUiTreeInspector } = require(path.join(REPO, "electron/ui-tree.cjs"));
const { createDesktopDoctor } = require(path.join(REPO, "electron/desktop-doctor.cjs"));
const { linuxDiagnostics } = require(path.join(REPO, "electron/linux-system.cjs"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function findChromeBinary() {
  for (const bin of [process.env.CHROME_BIN, "google-chrome", "chromium", "chromium-browser"].filter(Boolean)) {
    try {
      const p = execFileSync("which", [bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (p) return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function isDisplayAlive(display) {
  try {
    execFileSync("xdotool", ["getmouselocation"], {
      env: { ...process.env, DISPLAY: display },
      stdio: "ignore",
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on("error", () => resolve(false));
        req.setTimeout(1000, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return true;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  return false;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WsClient(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
      this.ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        } else if (msg.method) {
          this.events.push(msg);
        }
      });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "JS exception");
    }
    return r.result?.value;
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const DISPLAY = process.env.DISPLAY || ":99";
  const VITE_PORT = Number(process.env.E2E_VITE_PORT || 0) || (await getFreePort());
  const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 0) || (await getFreePort());
  const CDP_PORT = Number(process.env.E2E_CDP_PORT || 0) || (await getFreePort());
  const userDataDir = `/tmp/jarvis_e2e_xvfb_${process.pid}`;

  const chromeBin = findChromeBinary();
  if (!chromeBin) {
    console.error("❌ Brak przeglądarki google-chrome/chromium w PATH.");
    process.exit(1);
  }

  let xvfbProc = null;
  if (!isDisplayAlive(DISPLAY)) {
    xvfbProc = spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x1024x24", "-ac", "+extension", "GLX", "+render", "-noreset"], {
      stdio: "ignore",
    });
    for (let i = 0; i < 20 && !isDisplayAlive(DISPLAY); i++) await sleep(200);
    if (!isDisplayAlive(DISPLAY)) {
      console.error(`❌ Nie udało się uruchomić Xvfb na ${DISPLAY}.`);
      process.exit(1);
    }
  }

  const xEnv = { ...process.env, DISPLAY };
  const electronBinaryPath = path.join(REPO, "node_modules/electron/dist/electron");
  const electronBinaryInstalled = fs.existsSync(electronBinaryPath);

  const pilot = createDesktopPilot({ env: xEnv, getScreenSize: () => ({ width: 1280, height: 1024 }) });
  const linuxKb = createLinuxKeyboard({ env: { DISPLAY } });
  const uiTree = createUiTreeInspector({ env: xEnv });
  const doctor = createDesktopDoctor({ env: xEnv });

  let cdp = null;
  let launchInvocations = 0;

  const bridge = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const arg = body ? JSON.parse(body) : {};
        let out;
        if (req.url === "/pilotCursorPos") out = await pilot.cursorPosition();
        else if (req.url === "/pilotMove") out = await pilot.moveCursor(arg);
        else if (req.url === "/pilotMouse") out = await pilot.mouseAction(arg);
        else if (req.url === "/pilotScroll") out = await pilot.scroll(arg);
        else if (req.url === "/pilotDrag") out = await pilot.drag(arg);
        else if (req.url === "/pilotWindows") out = await pilot.listWindows();
        else if (req.url === "/pilotFocus") out = await pilot.focusWindow(arg.query);
        else if (req.url === "/pilotTypeUnicode") out = await pilot.typeUnicode(arg.text);
        else if (req.url === "/pilotHotkey") out = await pilot.globalHotkey(arg.combo);
        else if (req.url === "/pilotAbort") out = pilot.abort();
        else if (req.url === "/pilotUiTree") out = await uiTree.queryTree(arg.maxNodes || 120);
        else if (req.url === "/pilotUiFind") out = await uiTree.findNode(arg.query);
        else if (req.url === "/desktopDiagnose") out = await doctor.diagnose();
        else if (req.url === "/systemDiagnostics") out = await linuxDiagnostics({ env: xEnv });
        else if (req.url === "/launch") {
          launchInvocations += 1;
          out = "ok";
        } else if (req.url === "/screenshotDetailed") {
          const pos = await pilot.cursorPosition();
          let data = "";
          if (cdp) {
            const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
            data = shot.data || "";
          }
          out = {
            ok: !!data,
            data,
            mediaType: "image/png",
            width: 1120,
            height: 820,
            screenWidth: 1280,
            screenHeight: 1024,
            cursorX: pos.x || 0,
            cursorY: pos.y || 0,
          };
        } else {
          out = { ok: false, error: "err:unknown-endpoint" };
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
  });

  await new Promise((r) => bridge.listen(BRIDGE_PORT, "127.0.0.1", r));

  const vite = spawn(
    process.execPath,
    [path.join(REPO, "node_modules/vite/bin/vite.js"), "--port", String(VITE_PORT), "--host", "127.0.0.1"],
    {
      cwd: REPO,
      env: { ...xEnv, JARVIS_LICENSE_REQUIRED: "false" },
      stdio: "ignore",
    },
  );

  const chrome = spawn(
    chromeBin,
    [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--window-size=1200,860",
      "about:blank",
    ],
    { env: xEnv, stdio: "ignore" },
  );

  const checks = [];
  const assertCheck = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    const icon = ok ? "✅" : "❌";
    console.log(`${icon} [E2E-Xvfb] ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  };

  try {
    const [viteOk, cdpOk] = await Promise.all([
      waitForHttp(`http://127.0.0.1:${VITE_PORT}/`, 20000),
      waitForHttp(`http://127.0.0.1:${CDP_PORT}/json`, 20000),
    ]);
    if (!viteOk || !cdpOk) throw new Error(`Startup failed: vite=${viteOk}, cdp=${cdpOk}`);

    // CHECK 1: Real Xvfb OS Layer (linux-keyboard.cjs X11 unification + desktop-pilot + desktop-doctor)
    const kbActive = await linuxKb.activeWindow();
    assertCheck(
      "OS_X11_session_unified",
      kbActive.error !== "err:linux-session",
      `linux-keyboard on DISPLAY=${DISPLAY} (no XDG_SESSION_TYPE) => ${JSON.stringify(kbActive)}`,
    );
    const diag = await doctor.diagnose();
    const omniCheck = diag.checks.find((c) => c.id === "omni_stack");
    assertCheck(
      "OS_desktop_doctor_live",
      diag.ok && !!omniCheck && diag.checks.some((c) => c.id === "disk" && c.status === "ok"),
      `platform=${diag.platform}, checks=${diag.checks.length}, omni_stack=${omniCheck?.detail || "missing"}`,
    );

    const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json`);
    const pageTarget = targets.find((t) => t.type === "page");
    cdp = new CDP(pageTarget.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");

    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        try {
          localStorage.setItem("jarvis.onboarded.v1", "1");
          localStorage.setItem("jarvis.onboarded", "1");
        } catch {}
        const call = (ep, body) => fetch("http://127.0.0.1:${BRIDGE_PORT}" + ep, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body || {}),
        }).then(r => r.json());
        window.jarvisDesktop = {
          platform: "linux",
          open: async () => "ok",
          launch: (app) => call("/launch", { app }),
          power: async () => "ok",
          volume: async () => "ok",
          media: async () => "ok",
          screenshot: async () => (await call("/screenshotDetailed")).data || "err",
          notify: async () => "ok",
          type: async () => "ok",
          hotkey: async () => "ok",
          clipWatch: async () => false,
          onClipboard: () => () => {},
          onVoiceMode: () => () => {},
          onOmniAbort: () => () => {},
          systemDiagnostics: () => call("/systemDiagnostics"),
          pilotCursorPos: () => call("/pilotCursorPos"),
          pilotMove: (p) => call("/pilotMove", p),
          pilotMouse: (p) => call("/pilotMouse", p),
          pilotScroll: (p) => call("/pilotScroll", p),
          pilotDrag: (p) => call("/pilotDrag", p),
          pilotWindows: () => call("/pilotWindows"),
          pilotFocus: (query) => call("/pilotFocus", { query }),
          pilotTypeUnicode: (text) => call("/pilotTypeUnicode", { text }),
          pilotHotkey: (combo) => call("/pilotHotkey", { combo }),
          pilotAbort: () => call("/pilotAbort"),
          pilotUiTree: (maxNodes) => call("/pilotUiTree", { maxNodes }),
          pilotUiFind: (query) => call("/pilotUiFind", { query }),
          desktopDiagnose: () => call("/desktopDiagnose"),
          screenshotDetailed: () => call("/screenshotDetailed"),
        };
      `,
    });

    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${VITE_PORT}/` });
    await sleep(2500);

    await cdp.eval(`(async () => {
      for (let step = 0; step < 6; step++) {
        if (document.querySelector("textarea")) break;
        const btn = [...document.querySelectorAll("button")].find(b => /pomiń|pomin|dalej|uruchom jarvis|zacznij|rozpocznij|gotowe/i.test(b.innerText || ""));
        if (!btn) break;
        btn.click();
        await new Promise(r => setTimeout(r, 400));
      }
      return !!document.querySelector("textarea");
    })()`);
    await sleep(400);

    async function submitChat(text) {
      return cdp.eval(`(async () => {
        const ta = document.querySelector("textarea");
        if (!ta) return { ok: false, err: "no textarea" };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        setter.call(ta, ${JSON.stringify(text)});
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
        const btn = document.querySelector("button.send, button[aria-label*='Wyślij'], button[title*='Wyślij']");
        if (btn && !btn.disabled) {
          btn.click();
          return { ok: true, via: "button" };
        }
        ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        return { ok: true, via: "enter" };
      })()`);
    }

    async function readAuditAndGuardian() {
      return cdp.eval(`(() => {
        const guardianHist = JSON.parse(localStorage.getItem("jarvis.guardian.history") || "[]");
        let audit = [];
        let tasks = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          try {
            const v = JSON.parse(localStorage.getItem(k) || "null");
            if (v && Array.isArray(v.audit)) {
              audit = v.audit;
              tasks = Array.isArray(v.tasks) ? v.tasks : [];
            }
          } catch {}
        }
        return { audit, tasks, guardianHist };
      })()`);
    }

    // CHECK 2 (Flow A): Real Xvfb cursor move + Unified AuditLog & Runtime Guardian History
    await pilot.moveCursor({ mode: "absolute", x: 400, y: 400, smooth: false });
    const posBefore = await pilot.cursorPosition();
    await submitChat("przesuń kursor w prawo");
    await sleep(1100);
    const posAfter = await pilot.cursorPosition();
    const deltaX = (posAfter.x || 0) - (posBefore.x || 0);
    const traceA = await readAuditAndGuardian();
    assertCheck(
      "FlowA_cursor_and_unified_audit",
      deltaX === 240 &&
        traceA.audit.some((a) => a.tool === "omni_cursor_move" && a.status === "ok") &&
        traceA.guardianHist.length > 0,
      { deltaX, auditCount: traceA.audit.length, guardianHistoryCount: traceA.guardianHist.length },
    );

    // CHECK 3 (Flow B): RiskGuard hard-block on destructive voice launch + security audit trace
    launchInvocations = 0;
    await submitChat("uruchom shutdown");
    await sleep(900);
    const traceB = await readAuditAndGuardian();
    const bodyAfterB = await cdp.eval(`document.body.innerText || ""`);
    assertCheck(
      "FlowB_riskguard_blocks_destructive_launch",
      launchInvocations === 0 &&
        /RiskGuard/i.test(bodyAfterB) &&
        traceB.audit.some((a) => a.tool === "omni_launch" && a.status === "denied") &&
        traceB.guardianHist.some((e) => e.kind === "security"),
      { launchInvocations, deniedAudit: traceB.audit[0]?.tool, hasSecurityEvent: traceB.guardianHist.some((e) => e.kind === "security") },
    );

    // CHECK 4 (Flow C): Error -> Sentinel Start (NO stale BŁĄD badge) -> Kill-Switch "stop"
    await submitChat("kliknij przycisk Ustawienia");
    await sleep(1400);
    await submitChat("pilnuj ekranu jak pojawi się błąd krytyczny");
    await sleep(1600);
    const hudDuringSentinel = await cdp.eval(`(() => {
      const hud = document.querySelector(".omni-hud");
      const badge = hud ? (hud.querySelector(".omni-badge")?.textContent || "").trim() : "";
      return { visible: !!hud, badge, text: hud ? hud.innerText.trim().slice(0, 260) : "" };
    })()`);
    assertCheck(
      "FlowC_sentinel_hud_no_stale_error_badge",
      hudDuringSentinel.visible && hudDuringSentinel.badge === "STRAŻNIK W TLE" && !/BŁĄD/.test(hudDuringSentinel.badge),
      hudDuringSentinel,
    );

    await submitChat("stop");
    await sleep(900);
    const hudAfterStop = await cdp.eval(`(() => {
      const hud = document.querySelector(".omni-hud");
      const badge = hud ? (hud.querySelector(".omni-badge")?.textContent || "").trim() : "";
      const hasSentinelBar = !!document.querySelector(".omni-sentinel-bar");
      return { visible: !!hud, badge, hasSentinelBar };
    })()`);
    assertCheck(
      "FlowC_kill_switch_stops_sentinel",
      !hudAfterStop.hasSentinelBar && hudAfterStop.badge !== "STRAŻNIK W TLE",
      hudAfterStop,
    );

    // CHECK 5 (Flow D): Dead Brains wired live in UI ("rozpocznij cel: audyt produkcyjny")
    await submitChat("rozpocznij cel: audyt produkcyjny");
    await sleep(1200);
    const traceD = await readAuditAndGuardian();
    const bodyAfterD = await cdp.eval(`document.body.innerText || ""`);
    assertCheck(
      "FlowD_dead_brains_goal_runtime_live",
      /Cel „audyt produkcyjny”/.test(bodyAfterD) &&
        traceD.tasks.some((t) => /audyt produkcyjny/i.test(t.title)),
      { matchedChat: /Cel „audyt produkcyjny”/.test(bodyAfterD), tasksCount: traceD.tasks.length },
    );

    // CHECK 6 (Flow E): AutoCore live runtime verification inside Chrome (TTS single source, Ollama VL, paid services > 0 USD)
    const autocoreLive = await cdp.eval(`(async () => {
      const gw = await import("/src/lib/autocore/gateway.ts");
      const bud = await import("/src/lib/autocore/budget.ts");
      const cat = await import("/src/lib/autocore/catalog.ts");
      const v = await import("/src/lib/voice.ts");
      const st = await import("/src/lib/store.ts");
      const prevBudget = bud.budgetState();
      bud.resetBudget();
      gw.reportOutcome("elevenlabs", "eleven_flash_v2_5", "k", true, { units: 1000 });
      gw.reportOutcome("fal", "fal-flux-kontext", "k", true, { units: 1 });
      gw.reportOutcome("tavily", "advanced", "k", true, { units: 1 });
      const after = bud.budgetState();
      const ttsSame = gw.resolveVoiceEngine(st.store.settings) === v.resolveVoiceMode(st.store.settings);
      const ollamaVl = cat.providerSupportsVision("ollama", "qwen2.5-vl:7b");
      bud.resetBudget();
      return {
        spentMonthUsd: after.spentMonthUsd,
        ttsSame,
        ollamaVl,
        prevSpent: prevBudget.spentMonthUsd,
      };
    })()`);
    assertCheck(
      "FlowE_autocore_budget_tts_ollama_vl_runtime",
      autocoreLive.spentMonthUsd > 0.05 && autocoreLive.ttsSame && autocoreLive.ollamaVl,
      autocoreLive,
    );

    // CHECK 7 (Flow F): Local-only Ollama in provider:"auto" -> open LiveOverlay (NO fake missing-AI block!) + 0 CORS errors
    await cdp.eval(`(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        try {
          const v = JSON.parse(localStorage.getItem(k) || "null");
          if (v && typeof v === "object" && "provider" in v && "keys" in v) {
            v.provider = "auto";
            v.ollamaUrl = "http://127.0.0.1:11434";
            v.keys = {};
            localStorage.setItem(k, JSON.stringify(v));
            break;
          }
        } catch {}
      }
    })()`);
    await cdp.send("Page.reload");
    await sleep(2200);
    const liveOverlayRes = await cdp.eval(`(async () => {
      for (let step = 0; step < 6; step++) {
        if (document.querySelector("textarea")) break;
        const btn = [...document.querySelectorAll("button")].find(b => /pomiń|pomin|dalej|uruchom jarvis|zacznij/i.test(b.innerText || ""));
        if (!btn) break;
        btn.click();
        await new Promise(r => setTimeout(r, 400));
      }
      const liveBtn = [...document.querySelectorAll("button")].find(b => /live|na żywo|rozmowa głosowa|głos na żywo|☎/i.test((b.innerText || "") + " " + (b.title || "") + " " + (b.getAttribute("aria-label") || "")));
      if (!liveBtn) return { foundBtn: false, sheetText: "" };
      liveBtn.click();
      await new Promise(r => setTimeout(r, 1200));
      const sheet = document.querySelector(".sheet.live, .live-overlay, [class*='live']");
      return {
        foundBtn: true,
        sheetText: sheet ? sheet.innerText.trim().slice(0, 400) : (document.body.innerText || "").slice(-400),
      };
    })()`);
    assertCheck(
      "FlowF_live_overlay_local_ollama_auto_unblocked",
      liveOverlayRes.foundBtn &&
        !/Brak skonfigurowanego modelu AI/i.test(liveOverlayRes.sheetText) &&
        /OLLAMA \(LOKALNY\)/i.test(liveOverlayRes.sheetText),
      liveOverlayRes,
    );

    const corsErrors = cdp.events
      .filter((e) => e.method === "Log.entryAdded" && /cors|linux\.json/i.test(e.params?.entry?.text || ""))
      .map((e) => e.params.entry.text);
    const pageExceptions = cdp.events
      .filter((e) => e.method === "Runtime.exceptionThrown")
      .map((e) => e.params?.exceptionDetails?.text || "Runtime.exceptionThrown");
    assertCheck(
      "Console_zero_CORS_and_zero_JS_exceptions",
      corsErrors.length === 0 && pageExceptions.length === 0,
      { corsErrors, pageExceptions },
    );

    console.log(
      `ℹ️  [E2E-Xvfb] Electron binary status: ${
        electronBinaryInstalled
          ? "installed"
          : "NOT installed in VM (native Electron IPC/safeStorage/desktopCapturer/Ctrl+Alt+X require physical Linux hardware test)"
      }`,
    );

    const failed = checks.filter((c) => !c.ok);
    console.log(`\n📊 [E2E-Xvfb] Podsumowanie: ${checks.length - failed.length}/${checks.length} PASS`);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (cdp) cdp.close();
    bridge.close();
    try { chrome.kill("SIGKILL"); } catch { /* ignore */ }
    try { vite.kill("SIGKILL"); } catch { /* ignore */ }
    if (xvfbProc) {
      try { xvfbProc.kill("SIGKILL"); } catch { /* ignore */ }
    }
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error("❌ [E2E-Xvfb] Krytyczny błąd sondy:", e);
  process.exit(1);
});
