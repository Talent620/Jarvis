import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeSandboxedBrowser } from "./helpers/browserPrerequisite";
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
  integrationTestCount: 5,
  integrationTests: browserPrecondition.status === "READY" ? "REQUIRED: see Vitest assertion results"
    : browserPrecondition.status === "BLOCKED" ? "BLOCKED: not executed" : "NOT_RUN: prerequisite FAILED",
  desktopAcceptance: "NOT_RUN", modelAcceptance: "NOT_RUN",
}, null, 2) + "\n");
const prerequisiteSummary = browserPrecondition.attempts.map(({ executable, code, reason }) => JSON.stringify({ executable: executable.slice(0, 500), code, reason })).join("; ");
if (browserPrecondition.status !== "READY") console.warn(`[browser prerequisite] ${browserPrecondition.status}: ${browserPrecondition.attempts.map(a => `${a.executable}: ${a.code}`).join("; ")}. Evidence: QA/runs/browser-session/precondition.json`);
it("requires a working sandboxed renderer in CI or explicitly required native runs", context => {
  if (!browserRequired && browserPrecondition.status === "BLOCKED") return context.skip();
  expect(browserPrecondition.status, `Sandboxed browser prerequisite ${browserPrecondition.status}: ${prerequisiteSummary}. Evidence: QA/runs/browser-session/precondition.json. No browser/desktop PASS is established.`).toBe("READY");
});
const temporary: string[] = [], servers: Server[] = [], clients: any[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.stop()));
  await Promise.all(servers.splice(0).map(s => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); })));
  await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true })));
});
async function fixture(approveMutation?: (request: any) => Promise<boolean>, overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "jarvis-browser-")); temporary.push(root);
  const requests: Array<{ method: string; path: string; body: string }> = [];
  const server = createServer((req, res) => {
    let body = "";req.on("data", c => body += c); req.on("end", () => {
      requests.push({ method: req.method!, path: req.url!, body });
      if (req.url === "/download") { res.writeHead(200, { "content-type": "text/plain", "content-length": Buffer.byteLength("Zażółć gęślą jaźń") }); res.end("Zażółć gęślą jaźń"); return; }
      if (req.url === "/submit") { res.writeHead(200, { "content-type": "text/plain" }); res.end("recorded"); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Kontrolowany formularz</title><main><p>Treść źródła</p><form action="/submit" method="post"><label for="name">Nazwa</label><input id="name" name="name" oninput="fetch('/autosave?draft='+encodeURIComponent(this.value));setTimeout(()=>fetch('/later?draft='+encodeURIComponent(this.value)),250)"><button id="send" type="submit">Wyślij</button></form><a id="file" href="/download">Pobierz</a><a id="html" href="/">HTML</a><form action="/initial" method="get"><input name="target" value="initial"><button id="get-send" onclick="this.form.action='/mutated';this.form.elements.target.value='changed'">GET</button></form></main>`);
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
// The five assertions below are unchanged. An unavailable/failed prerequisite prevents execution;
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
    const { client, origin, requests } = await fixture(async () => { entered(); return new Promise<boolean>(resolve => release = resolve); });
    await client.command({ action: "grant", origin, actions: ["read", "interact"], allowLocal: true }, { trustedUserAction: true });
    await client.command({ action: "open", url: origin });
    await client.command({ action: "fill", selector: "#name", value: "Nie wysyłaj" });
    const pending = client.command({ action: "click", selector: "#send" }).catch((e: Error) => e);
    await awaitingApproval; await client.stop();
    // STOP must settle even if the owner has not answered the native approval.
    expect(await Promise.race([pending, new Promise(r => setTimeout(() => r("hung"), 500))])).toBeInstanceOf(Error);
    release(true);
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

});
