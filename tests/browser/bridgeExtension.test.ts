// BrowserBridge on a real Chromium (M8): the unpacked extension is loaded, paired through its
// options page with the code JARVIS shows, and then JARVIS observes and drives the current tab
// through the same ComputerEnvironment contract (read-backs included).
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { BridgeServer } from "../../src/node/bridge/server";
import { Pairing, TokenStore } from "../../src/node/bridge/protocol";
import { Kernel } from "../../src/lib/runtime/kernel";
import { performAction } from "../../src/lib/runtime/actions";
import type { EnvEvent, PageRead, SelectionRead } from "../../src/lib/runtime/env/types";
// @ts-expect-error plain ESM fixture without types
import { startYoutubeFixture } from "../fixtures/youtube/server.mjs";
import { findChromium } from "./chromium";

const until = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("JARVIS Bridge extension in Chromium", () => {
  it("pairs, reports the current tab and selection, navigates with read-back, keeps the token", async () => {
    const fixture = await startYoutubeFixture({ rerenderMs: 0 });
    const pairing = new Pairing();
    const tokens = new TokenStore();
    const server = new BridgeServer({ tokens, pairing });
    const port = await server.start();
    const ext = resolve("extension/browser-bridge");
    const profile = mkdtempSync(join(tmpdir(), "jarvis-bridge-"));
    const ctx = await chromium.launchPersistentContext(profile, {
      executablePath: findChromium(), headless: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    // The user already answered the fixture's consent wall in this browser.
    await ctx.addCookies([{ name: "jarvis_yt_consent", value: "reject", url: fixture.url }]);
    const events: EnvEvent[] = [];
    server.env.onEvent((e) => events.push(e));
    try {
      let [sw] = ctx.serviceWorkers();
      if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10_000 });
      const extensionId = new URL(sw.url()).host;

      // The user types the code JARVIS shows into the extension's options page.
      const code = pairing.issue();
      const options = await ctx.newPage();
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await options.fill("#port", String(port));
      await options.fill("#code", code);
      await options.click("#pair");
      await until(() => server.env.connected);
      expect(tokens.list()).toEqual([expect.objectContaining({ extensionId, browser: "chromium" })]);
      await options.close();

      // The user's own tab: JARVIS sees it and its selection.
      const tab = await ctx.newPage();
      await tab.goto(`${fixture.url}/`);
      await tab.bringToFront();
      await until(() => events.some((e) => e.type === "navigation" && e.url.startsWith(fixture.url)));
      const page = (await server.env.read({ kind: "page" })) as PageRead;
      expect(page).toMatchObject({ open: true, url: `${fixture.url}/` });
      await tab.evaluate(() => {
        const h = document.querySelector("h1, h2, p") as HTMLElement;
        const r = document.createRange();
        r.selectNodeContents(h);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
      });
      await until(() => events.some((e) => e.type === "selection" && e.text.length > 0));
      expect(((await server.env.read({ kind: "selection" })) as SelectionRead).text.length).toBeGreaterThan(0);

      // A command through the action engine, confirmed by reading the tab back.
      const kernel = new Kernel();
      kernel.dispatch({ type: "CapabilitiesUpdated", capabilities: await server.env.capabilities() });
      kernel.dispatch({ type: "TaskCreated", taskId: "T", goal: "bridge", kind: "k" });
      const target = `${fixture.url}/watch?v=lodz`;
      const nav = await performAction({ kernel, env: server.env }, { taskId: "T", action: { kind: "browser.navigate", url: target } });
      expect(nav.truth).toBe("CONFIRMED");
      expect(((await server.env.read({ kind: "page" })) as PageRead).url).toBe(target);

      // A new connection authenticates with the stored token: the pairing code is already used up.
      let reconnects = 0;
      server.env.onEvent((e) => { if (e.type === "closed") reconnects++; });
      const opts = await ctx.newPage();
      await opts.goto(`chrome-extension://${extensionId}/options.html`);
      await opts.evaluate(() => (globalThis as unknown as { chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } } }).chrome.runtime.sendMessage({ type: "reconnect" }));
      await until(() => reconnects > 0, 10_000);
      await until(() => server.env.connected, 20_000);
      expect(pairing.consume(code)).toBe(false);
      expect(tokens.list()).toHaveLength(1);
    } finally {
      await ctx.close();
      await server.close();
      await fixture.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }, 90_000);
});
