import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPrerequisiteSummary, probeSandboxedBrowser } from "./helpers/browserPrerequisite";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { createBrowserSession, webUrl } = require("../electron/browser-session.cjs");
const browserPrecondition = await probeSandboxedBrowser();
const executablePath = browserPrecondition.selectedExecutable || undefined;
const browserRequired = process.env.CI === "true" || process.env.JARVIS_REQUIRE_BROWSER_TESTS === "1";
let commit: string | null = process.env.GITHUB_SHA || null;
if (!commit) { try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* packaged test copies may have no Git metadata */ } }
const evidenceDirectory = join(process.cwd(), "QA", "runs", "browser-session");
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(join(evidenceDirectory, "precondition.json"), JSON.stringify({
  schemaVersion: 1, recordedAt: new Date().toISOString(), commit, platform: process.platform,
  required: browserRequired, ...browserPrecondition,
  integrationTestCount: 12,
  integrationTests: browserPrecondition.status === "READY" ? "REQUIRED: see Vitest assertion results"
    : browserPrecondition.status === "BLOCKED" ? "BLOCKED: not executed" : "NOT_RUN: prerequisite FAILED",
  desktopAcceptance: "NOT_RUN", modelAcceptance: "NOT_RUN",
}, null, 2) + "\n");
const prerequisiteSummary = browserPrerequisiteSummary(browserPrecondition);
if (browserPrecondition.status !== "READY") console.warn(`[browser prerequisite] ${prerequisiteSummary}. Evidence: QA/runs/browser-session/precondition.json`);
it("requires a working sandboxed renderer in CI or explicitly required native runs", context => {
  if (!browserRequired && browserPrecondition.status === "BLOCKED") return context.skip();
  expect(browserPrecondition.status, `${prerequisiteSummary}. Evidence: QA/runs/browser-session/precondition.json. No browser/desktop PASS is established.`).toBe("READY");
});
const temporary: string[] = [], servers: Server[] = [], clients: any[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.stop()));
  await Promise.all(servers.splice(0).map(s => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); })));
  await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true })));
});
async function fixture(approveMutation?: (request: any) => Promise<boolean>, overrides: Record<string, unknown> = {}, fixtureOptions: { latchDraft?: boolean; redirectTarget?: string; redirectEmbedding?: "main" | "image" | "iframe" | "submit" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "jarvis-browser-")); temporary.push(root);
  const requests: Array<{ method: string; path: string; body: string }> = [];
  const draftScript = fixtureOptions.latchDraft
    ? "window.jarvisTestReleaseDraft=()=>fetch('/later?draft='+encodeURIComponent(this.value),{keepalive:true}).catch(()=>{});"
    : "setTimeout(()=>fetch('/later?draft='+encodeURIComponent(this.value)),250)";
  const server = createServer((req, res) => {
    let body = "";req.on("data", c => body += c); req.on("end", () => {
      requests.push({ method: req.method!, path: req.url!, body });
      if (fixtureOptions.redirectTarget && (req.url === "/redirect" || fixtureOptions.redirectEmbedding === "main" || (fixtureOptions.redirectEmbedding === "submit" && req.url === "/submit"))) {
        res.writeHead(302, { location: fixtureOptions.redirectTarget }); res.end(); return;
      }
      if (fixtureOptions.redirectEmbedding && fixtureOptions.redirectEmbedding !== "submit") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<!doctype html><title>Redirect boundary</title><p id="result">pending</p>${fixtureOptions.redirectEmbedding === "image"
          ? '<img src="/redirect" onerror="document.getElementById(\'result\').textContent=\'image blocked\'">'
          : '<iframe src="/redirect"></iframe>'}`); return;
      }
      if (req.url === "/download") { res.writeHead(200, { "content-type": "text/plain", "content-length": Buffer.byteLength("Zażółć gęślą jaźń") }); res.end("Zażółć gęślą jaźń"); return; }
      if (req.url === "/submit") { res.writeHead(200, { "content-type": "text/plain" }); res.end("recorded"); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Kontrolowany formularz</title><main><p>Treść źródła</p><form action="/submit" method="post"><label for="name">Nazwa</label><input id="name" name="name" oninput="fetch('/autosave?draft='+encodeURIComponent(this.value));${draftScript}"><button id="send" type="submit" onclick="${fixtureOptions.latchDraft ? 'window.jarvisTestReleaseDraft();' : ''}">Wyślij</button><button id="background-send" type="button" onclick="fetch('/background-send',{method:'POST',body:'draft'}).catch(()=>{})">SPA</button></form><a id="file" href="/download">Pobierz</a><a id="html" href="/">HTML</a><form action="/initial" method="get"><input name="target" value="initial"><button id="get-send" onclick="this.form.action='/mutated';this.form.elements.target.value='changed'">GET</button></form></main>`);
    });
  });servers.push(server);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const client = createBrowserSession({ directory: join(root, "state"), downloadDirectory: join(root, "downloads"), executablePath: overrides.launch ? process.execPath : executablePath, headless: true, approveMutation, ...overrides }); clients.push(client);
  return { client, root, origin, requests };
}
describe("browser input validation", () => {
  it("rejects local file/javascript schemes and embedded credentials/secrets", () => {
    for (const input of ["file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/?token=secret"]) expect(() => webUrl(input)).toThrow();
  });
  it("requires actual user scope authorization and explicit local admission", async () => {
    const { client, origin } = await fixture();
    await expect(client.command({ action: "grant", origin, actions: ["read"], allowLocal: true })).rejects.toThrow(/użytkownik/);
    await expect(client.command({ action: "grant", origin, actions: ["read"] }, { trustedUserAction: true })).rejects.toThrow(/lokalnego/);
    await client.command({ action: "grant", origin, actions: ["read"], allowLocal: true }, { trustedUserAction: true });
    await expect(client.command({ action: "grant", origin, actions: ["read", "interact"] }, { trustedUserAction: true })).rejects.toThrow(/lokalnego/);
    expect((await client.command({ action: "status" })).grants).toMatchObject([{ origin, actions: ["read"], allowLocal: true }]);
  });
  it("does not launch Chromium after STOP while startup DNS is pending", async () => {
    let call = 0, release: (v: unknown) => void = () => {}, entered: () => void = () => {};
    const waiting = new Promise<void>(r => entered = r);
    const launch = vi.fn();
    const { client, origin } = await fixture(undefined, { launch, lookup: async () => {
      if (++call === 1) return [{ address: "127.0.0.1", family: 4 }];
      entered(); return new Promise(r => release = r);
    } });
    await client.command({ action: "grant", origin, actions: ["read"], allowLocal: true }, { trustedUserAction: true });
    const pending = client.command({ action: "open", url: origin }).catch((e: Error) => e);
    await waiting; await client.stop();
    expect(await Promise.race([pending, new Promise(r => setTimeout(() => r("hung"), 500))])).toBeInstanceOf(Error);
    release([{ address: "127.0.0.1", family: 4 }]);
    expect(launch).not.toHaveBeenCalled();
  });

  it("does not report STOP finished while an owned Chromium launch is still pending", async () => {
    let entered: () => void = () => {}, release: (browser: unknown) => void = () => {};
    const launching = new Promise<void>(r => entered = r), closed = vi.fn(async () => {});
    const { client, origin } = await fixture(undefined, { launch: () => { entered(); return new Promise(r => release = r); } });
    await client.command({ action: "grant", origin, actions: ["read"], allowLocal: true }, { trustedUserAction: true });
    const pending = client.command({ action: "open", url: origin }).catch((e: Error) => e);
    await launching;
    let stopSettled = false;
    const stop = client.stop().then((r: unknown) => { stopSettled = true; return r; });
    await Promise.resolve();
    expect(stopSettled).toBe(false);
    expect(await client.command({ action: "status" })).toMatchObject({ busy: true, starting: true });
    release({ close: closed });
    expect(await pending).toBeInstanceOf(Error);
    expect(await stop).toMatchObject({ stopped: true });
    expect(closed).toHaveBeenCalled();
  });

});
// Existing browser assertions are retained; security regressions add further cases. An unavailable/failed prerequisite prevents execution;
// CI still fails the prerequisite test, and never reports skipped native execution as success.
describe.skipIf(browserPrecondition.status !== "READY")("actual sandboxed Chromium with controlled website (not LLM)", () => {
  it("reads DOM, fills a draft, asks separately for submission and verifies a bounded download", async () => {
    const approvals: any[] = [];
    const { client, origin, requests } = await fixture(async request => { approvals.push(request); return true; });
    await client.command({ action: "grant", origin, actions: ["read", "interact", "download"], allowLocal: true }, { trustedUserAction: true });
    expect(await client.command({ action: "open", url: origin })).toMatchObject({ ok: true, title: "Kontrolowany formularz" });
    expect((await client.command({ action: "read" })).untrustedPageData.text).toContain("Treść źródła");
    expect(await client.command({ action: "fill", selector: "#name", value: "Zażółć" })).toMatchObject({ draft: true, verifiedValue: true });
    expect(requests.filter(r => r.method === "POST")).toHaveLength(0);
    expect(requests.some(r => r.path.startsWith("/autosave"))).toBe(false);
    const download = await client.command({ action: "download", selector: "#file" });
    expect(await readFile(download.path, "utf8")).toBe("Zażółć gęślą jaźń");
    expect(download.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(client.command({ action: "download", selector: "#html" })).rejects.toThrow(/HTML/);
    await client.command({ action: "click", selector: "#send" });
    await new Promise(r => setTimeout(r, 150));
    expect(approvals).toHaveLength(1);
    expect(requests.filter(r => r.method === "POST")).toHaveLength(1);
    expect(requests.find(r => r.method === "POST")?.body).toContain("name=");
    await client.command({ action: "revoke", origin });
    await expect(client.command({ action: "open", url: origin })).rejects.toThrow(/zgody/);
  }, 30000);
  it("STOP rejects late approval and blocks the external request", async () => {
    let release: (value: boolean) => void = () => {};
    let entered: () => void = () => {};
    const awaitingApproval = new Promise<void>(resolve => entered = resolve);
    const routes: Array<(route: any) => Promise<unknown>> = [];
    const { client, origin, requests } = await fixture(async () => { entered(); return new Promise<boolean>(resolve => release = resolve); }, {
      executablePath, launch: async (options: any) => {
        const browser = await require("playwright-core").chromium.launch(options);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (contextOptions: any) => {
          const context = await newContext(contextOptions), installRoute = context.route.bind(context);
          context.route = async (pattern: any, handler: any) => { routes.push(handler); return installRoute(pattern, handler); };
          return context;
        };
        return browser;
      },
    });
    await client.command({ action: "grant", origin, actions: ["read", "interact"], allowLocal: true }, { trustedUserAction: true });
    await client.command({ action: "open", url: origin });
    await client.command({ action: "fill", selector: "#name", value: "Nie wysyłaj" });
    const pending = client.command({ action: "click", selector: "#send" }).catch((e: Error) => e);
    await awaitingApproval; await client.stop();
    // STOP must settle even if the owner has not answered the native approval.
    expect(await Promise.race([pending, new Promise(r => setTimeout(() => r("hung"), 500))])).toBeInstanceOf(Error);
    await client.command({ action: "open", url: origin });
    release(true);
    // Deliver a queued route from the old session after a new one exists. It must
    // not read any request data or touch the new task's counters/audit.
    const staleRequest = vi.fn(), staleAbort = vi.fn(async () => {});
    const before = (await client.command({ action: "status" })).audit;
    await routes[0]({ request: staleRequest, abort: staleAbort });
    expect(staleRequest).not.toHaveBeenCalled();
    expect(staleAbort).toHaveBeenCalledWith("blockedbyclient");
    expect((await client.command({ action: "status" })).audit).toEqual(before);
    expect((await client.command({ action: "read" })).untrustedPageData.text).toContain("Treść źródła");
    expect(requests.filter(r => r.method === "POST")).toHaveLength(0);
  }, 30000);
  it("approves the actual mutated GET request and blocks denied query disclosure", async () => {
    const approvals: any[] = [];
    const { client, origin, requests } = await fixture(async request => { approvals.push(request); return false; });
    await client.command({ action: "grant", origin, actions: ["read", "interact"], allowLocal: true }, { trustedUserAction: true });
    await client.command({ action: "open", url: origin });
    await client.command({ action: "click", selector: "#get-send" }).catch(() => {});
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ method: "GET", url: `${origin}/mutated?target=changed` });
    expect(requests.some(r => r.path.startsWith("/mutated") || r.path.startsWith("/initial"))).toBe(false);
  }, 30000);
  it("refuses a download directory symlink and writes nothing outside its scope", async () => {
    const { client, origin, root } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "jarvis-download-outside-")); temporary.push(outside);
    await mkdir(join(root, "state"), { recursive: true });
    await symlink(outside, join(root, "downloads"), "dir");
    await client.command({ action: "grant", origin, actions: ["read", "download"], allowLocal: true }, { trustedUserAction: true });
    await client.command({ action: "open", url: origin });
    await expect(client.command({ action: "download", selector: "#file" })).rejects.toThrow(/dowiązania/);
    expect(await readdir(outside)).toEqual([]);
  }, 30000);

  it("keeps delayed draft requests blocked across a same-document open", async () => {
    const { client, origin, requests } = await fixture();
    await client.command({ action: "grant", origin, actions: ["read", "interact"], allowLocal: true }, { trustedUserAction: true });
    await client.command({ action: "open", url: origin });
    await client.command({ action: "fill", selector: "#name", value: "private-draft" });
    await client.command({ action: "open", url: `${origin}/#fragment` });
    await new Promise(r => setTimeout(r, 350));
    expect(requests.some(r => r.path.startsWith("/autosave") || r.path.startsWith("/later"))).toBe(false);
  }, 30000);

  it("does not let a delayed draft fetch join an in-flight navigation approval", async () => {
    const approvals: Array<{ method: string; url: string }> = [];
    let release: (value: boolean) => void = () => {}, entered: () => void = () => {}, actualBrowser: any;
    const waitingForPost = new Promise<void>(r => entered = r);
    const { client, origin, requests } = await fixture(async request => {
      approvals.push({ method: request.method, url: request.url });
      if (request.method === "POST") { entered(); return new Promise<boolean>(r => release = r); }
      return true;
    }, { executablePath, launch: async (options: any) => {
      actualBrowser = await require("playwright-core").chromium.launch(options); return actualBrowser;
    } }, { latchDraft: true });
    await client.command({ action: "grant", origin, actions: ["read", "interact"], allowLocal: true }, { trustedUserAction: true });
    await client.command({ action: "open", url: origin });
    await client.command({ action: "fill", selector: "#name", value: "private-draft" });
    const actualPage = actualBrowser.contexts()[0].pages()[0];
    const delayedResponse = actualPage.waitForRequest((r: any) => new URL(r.url()).pathname === "/later").then((r: any) => r.response());
    const pending = client.command({ action: "click", selector: "#send" }).catch((e: Error) => e);
    try {
      // The fixture releases its old draft callback during the clicked DOM event.
      // Hold the intended POST approval while independently observing that GET.
      await Promise.all([waitingForPost, delayedResponse]);
      console.info("Controlled request identities:", JSON.stringify({ approvals, received: requests.map(r => ({ method: r.method, path: r.path })) }));
      expect(approvals).toEqual([{ method: "POST", url: `${origin}/submit` }]);
      expect(requests.some(r => r.path.startsWith("/later") || r.path.startsWith("/autosave"))).toBe(false);
      release(true);
      expect(await pending).toMatchObject({ ok: true, externalEffectConfirmed: false });
      expect(requests.filter(r => r.method === "POST")).toHaveLength(1);
    } finally { release(false); await pending; }
  }, 30000);

  it.each(["main", "image", "iframe"] as const)("blocks %s redirects/child frames before an ungranted target receives a request", async mode => {
    let targetCalls = 0;
    const target = createServer((_req, res) => { targetCalls++; res.end("UNAUTHORIZED TARGET"); }); servers.push(target);
    await new Promise<void>(r => target.listen(0, "127.0.0.1", r));
    const redirectTarget = `http://127.0.0.1:${(target.address() as any).port}/private-target`;
    const { client, origin, requests } = await fixture(undefined, {}, { redirectTarget, redirectEmbedding: mode });
    await client.command({ action: "grant", origin, actions: ["read"], allowLocal: true }, { trustedUserAction: true });
    if (mode === "main") await expect(client.command({ action: "open", url: origin })).rejects.toThrow();
    else await client.command({ action: "open", url: origin });
    const expectedAction = mode === "iframe" ? "subframe-request" : "redirect-or-failed-response";
    let status = await client.command({ action: "status" });
    for (let i = 0; i < 100 && !status.audit.some((r: any) => r.action === expectedAction); i++) {
      await new Promise(r => setTimeout(r, 10)); status = await client.command({ action: "status" });
    }
    expect(status.audit.some((r: any) => r.action === expectedAction && r.result === "BLOCKED")).toBe(true);
    expect(status.interactionLimits).toMatchObject({ subframes: false, redirects: false, backgroundSubmissions: false });
    if (mode === "image") {
      let text = "";
      for (let i = 0; i < 100 && !text.includes("image blocked"); i++) { text = (await client.command({ action: "read" })).untrustedPageData.text; if (!text.includes("image blocked")) await new Promise(r => setTimeout(r, 10)); }
      expect(text).toContain("image blocked");
    }
    if (mode === "iframe") expect(requests.some(r => r.path === "/redirect")).toBe(false);
    expect(targetCalls).toBe(0);
    console.info("Controlled redirect boundary:", JSON.stringify({ mode, sourcePaths: requests.map(r => r.path), targetCalls }));
  }, 30000);

  it("reports a blocked SPA submission as blocked rather than a completed send", async () => {
    const approvals: any[] = [];
    const { client, origin, requests } = await fixture(async r => { approvals.push(r); return true; });
    await client.command({ action: "grant", origin, actions: ["read", "interact"], allowLocal: true }, { trustedUserAction: true });
    await client.command({ action: "open", url: origin });
    const result = await client.command({ action: "click", selector: "#background-send" });
    expect(result).toMatchObject({ ok: false, actionDispatched: true, externalEffectConfirmed: false, blockedRequestCount: 1 });
    expect(result.notice).toContain("fetch/XHR");
    expect(approvals).toEqual([]);
    expect(requests.some(r => r.path === "/background-send")).toBe(false);
    const status = await client.command({ action: "status" });
    expect(status.audit.at(-1)).toMatchObject({ action: "click", result: "BLOCKED" });
  }, 30000);

  it("reports an owner-denied navigation as denied with no sent POST", async () => {
    const approvals: any[] = [];
    const { client, origin, requests } = await fixture(async r => { approvals.push(r); return false; });
    await client.command({ action: "grant", origin, actions: ["read", "interact"], allowLocal: true }, { trustedUserAction: true });
    await client.command({ action: "open", url: origin });
    const result = await client.command({ action: "click", selector: "#send" });
    expect(result).toMatchObject({ ok: false, code: "APPROVAL_DENIED", actionDispatched: true, externalEffectConfirmed: false });
    expect(result.error).toContain("odmówił");
    expect(approvals).toHaveLength(1);
    expect(requests.filter(r => r.method === "POST")).toHaveLength(0);
    const status = await client.command({ action: "status" });
    expect(status.audit.some((r: any) => r.action === "external-request" && r.result === "DENIED")).toBe(true);
    expect(status.audit.at(-1)).toMatchObject({ action: "click", result: "BLOCKED" });
  }, 30000);

  it("keeps an approved POST uncertain when its redirect response is blocked", async () => {
    let targetCalls = 0;
    const target = createServer((_req, res) => { targetCalls++; res.end("UNAUTHORIZED TARGET"); }); servers.push(target);
    await new Promise<void>(r => target.listen(0, "127.0.0.1", r));
    const redirectTarget = `http://127.0.0.1:${(target.address() as any).port}/private-target`;
    const { client, origin, requests } = await fixture(async () => true, {}, { redirectTarget, redirectEmbedding: "submit" });
    await client.command({ action: "grant", origin, actions: ["read", "interact"], allowLocal: true }, { trustedUserAction: true });
    await client.command({ action: "open", url: origin });
    const result = await client.command({ action: "click", selector: "#send" });
    expect(requests.filter(r => r.method === "POST")).toHaveLength(1);
    expect(targetCalls).toBe(0);
    expect(result).toMatchObject({ ok: false, code: "BROWSER_EFFECT_UNCONFIRMED", uncertain: true, externalEffectConfirmed: false });
    expect(result.error).toContain("Nie ponawiaj");
    expect((await client.command({ action: "status" })).audit.at(-1)).toMatchObject({ action: "click", result: "UNCONFIRMED" });
  }, 30000);

});
