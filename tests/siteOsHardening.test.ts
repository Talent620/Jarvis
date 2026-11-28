import { describe, it, expect } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { extractDataUriAssets, restoreDataUriAssets } from "../src/lib/siteOs";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

function findPrivateLanIpv4(): string | null {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const info of entries || []) {
      if (info.family === "IPv4" && !info.internal) {
        const parts = info.address.split(".").map(Number);
        if (
          parts[0] === 10 ||
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168)
        ) {
          return info.address;
        }
      }
    }
  }
  return null;
}

function rawHttpRequest(opts: {
  host: string;
  port: number;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  localAddress?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; json: Record<string, unknown> | null }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body != null ? Buffer.from(opts.body, "utf8") : null;
    const req = http.request(
      {
        host: opts.host,
        port: opts.port,
        method: opts.method || "GET",
        path: opts.path,
        localAddress: opts.localAddress,
        headers: {
          ...(payload ? { "Content-Length": String(payload.length) } : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startSiteOsInstance(extraEnv: Record<string, string> = {}) {
  const port = await getFreePort();
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "jarvis-siteos-hardening-"));
  const dataDir = path.join(tmpDir, "data");
  const runtimeDir = path.join(tmpDir, "runtime");
  const env = {
    ...process.env,
    SITE_OS_HOST: "127.0.0.1",
    SITE_OS_PORT: String(port),
    SITE_OS_DATA_DIR: dataDir,
    SITE_OS_RUNTIME_DIR: runtimeDir,
    ...extraEnv,
  };
  const child = spawn(process.execPath, ["site-os/server.mjs"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Site OS start timeout")), 7000);
    child.stdout.on("data", (d) => {
      if (String(d).includes("Edytor:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Site OS exited early (${code})`));
    });
  });

  const stop = async () => {
    if (child.exitCode === null && !child.killed) {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
          resolve();
        }, 1200);
      });
    }
    rmSync(tmpDir, { recursive: true, force: true });
  };

  return { port, tmpDir, dataDir, runtimeDir, stop };
}

describe("F-04 — extractDataUriAssets: obsługa cudzysłowów, brakujących cudzysłowów i CSS url()", () => {
  const b64A = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42Y" + "A".repeat(220) + "=";
  const b64B = "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA" + "B".repeat(240) + "==";

  it("nie pochłania spacji ani sąsiednich atrybutów przy nieujętym w cudzysłów src=data:image/...", () => {
    const html = `<img src=data:image/png;base64,${b64A} alt="Bohater sekcji" width=480 loading=lazy>`;
    const { strippedHtml, assets } = extractDataUriAssets(html);

    expect(assets.size).toBe(1);
    expect(strippedHtml).toBe(`<img src=__JARVIS_ASSET_0__ alt="Bohater sekcji" width=480 loading=lazy>`);
    expect(restoreDataUriAssets(strippedHtml, assets)).toBe(html);
  });

  it("zachowuje samozamykający znacznik =/> przy nieujętym w cudzysłów atrybucie", () => {
    const html = `<img src=data:image/png;base64,${b64A}/>`;
    const { strippedHtml, assets } = extractDataUriAssets(html);

    expect(strippedHtml).toBe("<img src=__JARVIS_ASSET_0__/>");
    expect(restoreDataUriAssets(strippedHtml, assets)).toBe(html);
  });

  it("obsługuje podwójne i pojedyncze cudzysłowy (w tym wielowierszowy base64) oraz CSS url() bez utraty danych", () => {
    const multilineB64 = b64A.slice(0, 140) + "\r\n" + b64A.slice(140);
    const shortIcon = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    const html = [
      `<section style="background-image:url(data:image/webp;base64,${b64B});padding:24px" data-sec="hero">`,
      `  <img src="data:image/png;base64,${multilineB64}" alt="Okładka">`,
      `  <img src='data:image/webp;base64,${b64B}' data-role='card'>`,
      `  <img src="${shortIcon}" alt="1x1">`,
      `</section>`,
    ].join("\n");

    const { strippedHtml, assets } = extractDataUriAssets(html);
    expect(assets.size).toBe(3);
    expect(strippedHtml).toContain(`style="background-image:url(__JARVIS_ASSET_2__);padding:24px" data-sec="hero"`);
    expect(strippedHtml).toContain(`<img src="__JARVIS_ASSET_0__" alt="Okładka">`);
    expect(strippedHtml).toContain(`<img src='__JARVIS_ASSET_1__' data-role='card'>`);
    expect(strippedHtml).toContain(shortIcon);
    expect(restoreDataUriAssets(strippedHtml, assets)).toBe(html);
  });
});

describe("P1 + F-03 + F-05 — Site OS 2.0: izolacja /p/:id, obrona /api/session, limit SSE i separacja LAN/Tunel", () => {
  it("blokuje Origin: null, cross-origin, brak nagłówka, fałszywy Sec-Fetch/Referer/Host oraz tunel na /api/session", async () => {
    const inst = await startSiteOsInstance();
    try {
      const conn = JSON.parse(readFileSync(path.join(inst.runtimeDir, "connection.json"), "utf8")) as { token: string };

      const attacks: Array<{ name: string; headers: Record<string, string> }> = [
        { name: "brak X-SiteOS-Client (gołe żądanie / no-cors / <script>)", headers: {} },
        { name: "Origin: null (piaskownica /p/:id lub srcdoc)", headers: { "X-SiteOS-Client": "studio", Origin: "null" } },
        { name: "cross-origin https://evil.example", headers: { "X-SiteOS-Client": "studio", Origin: "https://evil.example" } },
        { name: "Sec-Fetch-Site: cross-site bez zaufanego Origin", headers: { "X-SiteOS-Client": "studio", "Sec-Fetch-Site": "cross-site" } },
        { name: "Sec-Fetch-Mode: navigate", headers: { "X-SiteOS-Client": "studio", "Sec-Fetch-Mode": "navigate" } },
        { name: "Sec-Fetch-Dest: iframe", headers: { "X-SiteOS-Client": "studio", "Sec-Fetch-Dest": "iframe" } },
        { name: "Referer z podglądu /p/:id", headers: { "X-SiteOS-Client": "studio", Referer: `http://127.0.0.1:${inst.port}/p/abc-123` } },
        { name: "DNS rebinding Host: evil.rebind.tld", headers: { "X-SiteOS-Client": "studio", Host: "evil.rebind.tld:3210" } },
        { name: "Cloudflare Tunnel CF-Connecting-IP", headers: { "X-SiteOS-Client": "studio", "CF-Connecting-IP": "203.0.113.9" } },
        { name: "Reverse proxy X-Forwarded-For", headers: { "X-SiteOS-Client": "studio", "X-Forwarded-For": "127.0.0.1" } },
      ];

      for (const atk of attacks) {
        const res = await rawHttpRequest({
          host: "127.0.0.1",
          port: inst.port,
          path: "/api/session",
          headers: atk.headers,
        });
        expect(res.status, `Atak powinien zwrócić 403: ${atk.name}`).toBe(403);
        expect(res.text).not.toContain(conn.token);
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      }

      const trustedStudio = await rawHttpRequest({
        host: "127.0.0.1",
        port: inst.port,
        path: "/api/session",
        headers: {
          "X-SiteOS-Client": "studio",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          Referer: `http://127.0.0.1:${inst.port}/`,
        },
      });
      expect(trustedStudio.status).toBe(200);
      expect(trustedStudio.json?.token).toBe(conn.token);

      const trustedJarvis = await rawHttpRequest({
        host: "127.0.0.1",
        port: inst.port,
        path: "/api/session",
        headers: {
          "X-SiteOS-Client": "jarvis",
          Origin: "http://localhost:5173",
          "Sec-Fetch-Site": "cross-site",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
        },
      });
      expect(trustedJarvis.status).toBe(200);
      expect(trustedJarvis.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      expect(trustedJarvis.json?.token).toBe(conn.token);
    } finally {
      await inst.stop();
    }
  }, 15000);

  it("F-03: egzekwuje limit MAX_SSE_CLIENTS (429 po osiągnięciu limitu) i zwalnia slot po rozłączeniu", async () => {
    const inst = await startSiteOsInstance({ SITE_OS_MAX_SSE_CLIENTS: "3" });
    const controllers: AbortController[] = [];
    try {
      const sessRes = await fetch(`http://127.0.0.1:${inst.port}/api/session`, {
        headers: { "X-SiteOS-Client": "cli" },
      });
      const { token } = (await sessRes.json()) as { token: string };
      const sseUrl = `http://127.0.0.1:${inst.port}/api/events?token=${encodeURIComponent(token)}`;

      for (let i = 0; i < 3; i++) {
        const ctrl = new AbortController();
        controllers.push(ctrl);
        const res = await fetch(sseUrl, { signal: ctrl.signal });
        expect(res.status).toBe(200);
      }

      const fourth = await fetch(sseUrl);
      expect(fourth.status).toBe(429);
      expect(fourth.headers.get("retry-after")).toBe("5");

      controllers[0].abort();
      await new Promise((r) => setTimeout(r, 80));

      const reconnectedCtrl = new AbortController();
      controllers.push(reconnectedCtrl);
      const reconnected = await fetch(sseUrl, { signal: reconnectedCtrl.signal });
      expect(reconnected.status).toBe(200);
    } finally {
      for (const c of controllers) {
        try { c.abort(); } catch { /* ignore */ }
      }
      await inst.stop();
    }
  }, 15000);

  it("F-05: rozdziela loopback, prywatny LAN RFC1918 (SITE_OS_HOST=0.0.0.0) i ruch proxy/tunelu", async () => {
    const lanIp = findPrivateLanIpv4();
    if (!lanIp) return;

    const inst = await startSiteOsInstance({ SITE_OS_HOST: "0.0.0.0" });
    try {
      const conn = JSON.parse(readFileSync(path.join(inst.runtimeDir, "connection.json"), "utf8")) as {
        token: string;
        pairingCode: string;
      };

      const lanRoot = await rawHttpRequest({ host: lanIp, port: inst.port, path: "/", localAddress: lanIp });
      expect(lanRoot.status).toBe(403);

      const lanSession = await rawHttpRequest({
        host: lanIp,
        port: inst.port,
        path: "/api/session",
        localAddress: lanIp,
        headers: { "X-SiteOS-Client": "jarvis" },
      });
      expect(lanSession.status).toBe(403);
      expect(lanSession.text).not.toContain(conn.token);

      const lanHealth = await rawHttpRequest({ host: lanIp, port: inst.port, path: "/api/health", localAddress: lanIp });
      expect(lanHealth.status).toBe(200);
      expect(lanHealth.json?.pairingRequired).toBe(true);
      expect(lanHealth.json?.tunnelUrl).toBeUndefined();

      const proxiedPairOnLan = await rawHttpRequest({
        host: lanIp,
        port: inst.port,
        method: "POST",
        path: "/api/pair",
        localAddress: lanIp,
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "192.168.0.99" },
        body: JSON.stringify({ code: conn.pairingCode }),
      });
      expect(proxiedPairOnLan.status).toBe(403);

      const pairOk = await rawHttpRequest({
        host: lanIp,
        port: inst.port,
        method: "POST",
        path: "/api/pair",
        localAddress: lanIp,
        headers: { "Content-Type": "application/json", Host: `${lanIp}:${inst.port}` },
        body: JSON.stringify({ code: conn.pairingCode }),
      });
      expect(pairOk.status).toBe(200);
      expect(pairOk.json?.token).toBe(conn.token);
      expect(pairOk.json?.url).toBe(`http://${lanIp}:${inst.port}`);

      const replayPair = await rawHttpRequest({
        host: lanIp,
        port: inst.port,
        method: "POST",
        path: "/api/pair",
        localAddress: lanIp,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: conn.pairingCode }),
      });
      expect(replayPair.status).toBe(401);

      const lanProjects = await rawHttpRequest({
        host: lanIp,
        port: inst.port,
        path: "/api/projects",
        localAddress: lanIp,
        headers: { Authorization: `Bearer ${conn.token}` },
      });
      expect(lanProjects.status).toBe(200);

      const lanTunnelStart = await rawHttpRequest({
        host: lanIp,
        port: inst.port,
        method: "POST",
        path: "/api/tunnel/start",
        localAddress: lanIp,
        headers: { Authorization: `Bearer ${conn.token}` },
      });
      expect(lanTunnelStart.status).toBe(403);
    } finally {
      await inst.stop();
    }
  }, 15000);

  it("P1-C (prawdziwa przeglądarka Chromium): niezaufany import HTML w /p/:id i Podglądzie JS NIE odczyta runtime.token, a panel i formularze nadal działają", async () => {
    let hasChrome = false;
    try {
      execFileSync("which", ["google-chrome"], { stdio: "ignore" });
      hasChrome = Boolean(process.env.DISPLAY || os.platform() === "linux");
    } catch {
      hasChrome = false;
    }
    if (!hasChrome) return;

    const inst = await startSiteOsInstance();
    const cdpPort = await getFreePort();
    const profileDir = mkdtempSync(path.join(os.tmpdir(), "jarvis-chrome-p1-"));
    const display = process.env.DISPLAY || ":99";
    const chrome = spawn(
      "google-chrome",
      [
        ...(process.env.DISPLAY ? [] : ["--headless=new"]),
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${cdpPort}`,
        "about:blank",
      ],
      { env: { ...process.env, DISPLAY: display }, stdio: "ignore", detached: true },
    );

    try {
      let wsUrl = "";
      for (let i = 0; i < 40; i++) {
        try {
          const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
          const targets = (await listRes.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
          const page = targets.find((t) => t.type === "page");
          if (page?.webSocketDebuggerUrl) {
            wsUrl = page.webSocketDebuggerUrl;
            break;
          }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(wsUrl).toBeTruthy();

      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve());
        ws.addEventListener("error", (e) => reject(e));
      });
      let seq = 0;
      const cdpSend = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const id = ++seq;
          const onMsg = (ev: MessageEvent) => {
            const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown>; error?: unknown };
            if (msg.id === id) {
              ws.removeEventListener("message", onMsg);
              if (msg.error) reject(new Error(JSON.stringify(msg.error)));
              else resolve(msg.result || {});
            }
          };
          ws.addEventListener("message", onMsg);
          ws.send(JSON.stringify({ id, method, params }));
        });
      const cdpEval = async <T>(expression: string): Promise<T> => {
        const r = (await cdpSend("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        })) as { result?: { value?: T }; exceptionDetails?: unknown };
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
        return r.result?.value as T;
      };

      await cdpSend("Page.enable");
      await cdpSend("Runtime.enable");

      await cdpSend("Page.navigate", { url: `http://127.0.0.1:${inst.port}/` });
      for (let i = 0; i < 30; i++) {
        const ready = await cdpEval<boolean>(`document.getElementById('app')?.dataset?.ready === 'true'`);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(await cdpEval<boolean>(`document.getElementById('app')?.dataset?.ready === 'true'`)).toBe(true);

      const sessRes = await fetch(`http://127.0.0.1:${inst.port}/api/session`, {
        headers: { "X-SiteOS-Client": "cli" },
      });
      const { token } = (await sessRes.json()) as { token: string };

      const evilHtml = `<!doctype html><html><body>
        <h1 id="headline">Importowany Projekt</h1>
        <form data-siteos-form id="leadForm">
          <input name="name" value="Klient Testowy">
          <input name="email" value="klient@example.com">
          <textarea name="message">Zapytanie z piaskownicy</textarea>
          <button type="submit">Wyślij</button>
          <div class="siteos-form__status"></div>
        </form>
        <script>
          window.__p1Audit = (async () => {
            const report = { origin: window.origin, storageBlocked: false, bareFetch: null, hdrFetch: null };
            try { localStorage.getItem("x"); } catch { report.storageBlocked = true; }
            try {
              const r1 = await fetch("/api/session");
              report.bareFetch = await r1.text();
            } catch (e) { report.bareFetch = "BLOCKED:" + e.name; }
            try {
              const r2 = await fetch("/api/session", { headers: { "X-SiteOS-Client": "studio" } });
              report.hdrFetch = await r2.text();
            } catch (e) { report.hdrFetch = "BLOCKED:" + e.name; }
            return report;
          })();
        </script>
      </body></html>`;

      const createdRes = await fetch(`http://127.0.0.1:${inst.port}/api/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SiteOS-Client": "studio",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: "Untrusted Import", html: evilHtml }),
      });
      const created = (await createdRes.json()) as { project: { id: string } };
      const projectId = created.project.id;

      await cdpSend("Page.navigate", { url: `http://127.0.0.1:${inst.port}/` });
      for (let i = 0; i < 30; i++) {
        const ready = await cdpEval<boolean>(`document.getElementById('app')?.dataset?.ready === 'true'`);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      await new Promise((r) => setTimeout(r, 250));
      const editModeScriptRan = await cdpEval<boolean>(
        `Boolean(document.getElementById('siteFrame')?.contentWindow?.__p1Audit)`,
      );
      expect(editModeScriptRan).toBe(false);

      await cdpEval(`document.getElementById('selectModeBtn').click()`);
      await new Promise((r) => setTimeout(r, 400));
      const jsPreviewIsolated = await cdpEval<{ sandbox: string; crossOriginBlocked: boolean }>(`(() => {
        const f = document.getElementById('siteFrame');
        let blocked = false;
        try { blocked = !f.contentDocument || !f.contentDocument.body; } catch { blocked = true; }
        return { sandbox: f.getAttribute('sandbox') || '', crossOriginBlocked: blocked };
      })()`);
      expect(jsPreviewIsolated.sandbox).toBe("allow-scripts allow-forms");
      expect(jsPreviewIsolated.crossOriginBlocked).toBe(true);

      await cdpSend("Page.navigate", { url: `http://127.0.0.1:${inst.port}/p/${projectId}` });
      await new Promise((r) => setTimeout(r, 500));

      const p1Report = await cdpEval<{
        origin: string;
        storageBlocked: boolean;
        bareFetch: string;
        hdrFetch: string;
      }>(`window.__p1Audit`);

      expect(p1Report.origin).toBe("null");
      expect(p1Report.storageBlocked).toBe(true);
      expect(String(p1Report.bareFetch)).toMatch(/^BLOCKED:/);
      expect(String(p1Report.hdrFetch)).toMatch(/^BLOCKED:/);
      expect(JSON.stringify(p1Report)).not.toContain(token);

      const leadStatus = await cdpEval<string>(`(async () => {
        const form = document.getElementById('leadForm');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        for (let i = 0; i < 20; i++) {
          const txt = document.querySelector('.siteos-form__status')?.textContent || '';
          if (txt.includes('Dziękujemy')) return txt;
          await new Promise(r => setTimeout(r, 100));
        }
        return document.querySelector('.siteos-form__status')?.textContent || '';
      })()`);
      expect(leadStatus).toContain("Dziękujemy");

      ws.close();
    } finally {
      try {
        if (chrome.pid) process.kill(-chrome.pid, "SIGKILL");
      } catch { /* ignore */ }
      rmSync(profileDir, { recursive: true, force: true });
      await inst.stop();
    }
  }, 25000);
});
