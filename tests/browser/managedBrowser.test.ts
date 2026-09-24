// ManagedBrowser hardening on a real Chromium: read-backs run in an isolated world (a hostile
// page cannot fake them), only http(s) navigation, and the system clipboard as copy read-back.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedBrowser } from "../../src/node/managedBrowser";
import type { ClipboardRead, PageRead, SelectionRead } from "../../src/lib/runtime/env/types";
import { findChromium } from "./chromium";

const HOSTILE = `<!doctype html><html><head><meta charset="utf-8"><title>Prawdziwy tytuł</title></head>
<body><p id="t">Łódź nocą</p>
<script>
  const r = document.createRange();
  const node = document.getElementById("t").firstChild;
  r.setStart(node, 0); r.setEnd(node, 4);
  getSelection().removeAllRanges(); getSelection().addRange(r);
  // The page now lies to anything reading through its own JavaScript world.
  const fake = () => ({ toString: () => "HACKED", rangeCount: 0 });
  Document.prototype.getSelection = fake;
  window.getSelection = fake;
  Object.defineProperty(document, "title", { get: () => "HACKED" });
  Object.defineProperty(window, "scrollY", { get: () => 99999 });
</script></body></html>`;

let server: Server;
let url = "";
const profiles: string[] = [];

function browser(opts: { readClipboard?: () => string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-mb-"));
  profiles.push(dir);
  return new ManagedBrowser({ userDataDir: dir, executablePath: findChromium(), headless: true, ...opts });
}

beforeAll(async () => {
  server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(HOSTILE); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const p of profiles) rmSync(p, { recursive: true, force: true });
});

describe("ManagedBrowser hardening", () => {
  it("read-backs come from an isolated world: page overrides of getSelection, title, scrollY are ignored", async () => {
    const b = browser();
    try {
      expect((await b.act({ kind: "browser.launch" })).status).toBe("done");
      expect((await b.act({ kind: "browser.navigate", url })).status).toBe("done");
      const page = (await b.read({ kind: "page" })) as PageRead;
      expect(page).toMatchObject({ open: true, url, title: "Prawdziwy tytuł", scrollY: 0 });
      const sel = (await b.read({ kind: "selection" })) as SelectionRead;
      expect(sel.text).toBe("Łódź");
    } finally {
      await b.close();
    }
  }, 60_000);

  it("only http(s) navigation is allowed", async () => {
    const b = browser();
    try {
      await b.act({ kind: "browser.launch" });
      for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "chrome://settings"]) {
        expect((await b.act({ kind: "browser.navigate", url: bad })).status).toBe("blocked");
      }
    } finally {
      await b.close();
    }
  }, 60_000);

  it("the clipboard read-back uses the system clipboard when one is given (Electron)", async () => {
    const b = browser({ readClipboard: () => "z systemowego schowka" });
    try {
      await b.act({ kind: "browser.launch" });
      expect((await b.read({ kind: "clipboard" })) as ClipboardRead).toEqual({ ok: true, text: "z systemowego schowka" });
    } finally {
      await b.close();
    }
  }, 60_000);
});
