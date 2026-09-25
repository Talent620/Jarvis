// Interleaved conversations on a real Chromium and the YouTube fixture (M3 browser subset).
// Comments load slowly (600 ms) so conversation happens while the action lane is working.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime, type Speaker } from "../../src/lib/runtime/lanes/runtime";
import type { ConversationModel } from "../../src/lib/runtime/lanes/conversation";
import { ManagedBrowser } from "../../src/node/managedBrowser";
import type { ClipboardRead, ElementRead } from "../../src/lib/runtime/env/types";
// @ts-expect-error plain ESM fixture without types
import { startYoutubeFixture } from "../fixtures/youtube/server.mjs";
import { findChromium } from "./chromium";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fixture: { url: string; close: () => Promise<void> };
let profile: string;
let browser: ManagedBrowser;
let kernel: Kernel;
let rt: JarvisRuntime;
let said: string[];
let cancels: number;

const model: ConversationModel = {
  async reply(input) {
    await sleep(20);
    return /pogod/i.test(input.utterance) ? "Jutro w Łodzi 18 stopni." : "Ciekawy film.";
  },
};

beforeEach(async () => {
  fixture = await startYoutubeFixture({ commentDelayMs: 600, rerenderMs: 2000 });
  profile = mkdtempSync(join(tmpdir(), "jarvis-conv-"));
  browser = new ManagedBrowser({ userDataDir: profile, executablePath: findChromium(), headless: true });
  kernel = new Kernel();
  said = [];
  cancels = 0;
  const speaker: Speaker = { say: (t) => { said.push(t); }, cancel: () => { cancels++; } };
  rt = new JarvisRuntime({ kernel, env: browser, model, speaker, session: { youtubeUrl: `${fixture.url}/` } });
  await rt.start();
  rt.onText("Jarvis, uruchom przeglądarkę.");
  rt.onText("Wejdź na YouTube.");
  rt.onText("Otwórz pierwszy film.");
  await rt.idle();
});

afterEach(async () => {
  rt.stop();
  await browser.close();
  await fixture.close();
  rmSync(profile, { recursive: true, force: true });
});

describe("interleaved conversations on Chromium", () => {
  it("weather while comments load, then back to the comment", async () => {
    rt.onText("Znajdź komentarze.");
    await sleep(150);
    rt.onText("a jaka jutro pogoda?");
    await sleep(100);
    expect(said).toContain("Jutro w Łodzi 18 stopni.");
    const busy = Object.values(kernel.state.tasks).find((t) => t.kind === "findCollection");
    expect(busy?.status).toBe("running"); // the chat answered while the action was still working
    rt.onText("Pierwszy komentarz.");
    await rt.idle();
    rt.onText("co sądzisz o tym filmie?");
    const back = rt.onText("dobra, wróćmy do komentarza");
    await rt.idle();
    expect(back.route).toBe("amend");
    expect(back.result?.truth).toBe("CONFIRMED");
    const el = (await browser.read({ kind: "element", target: { ref: "yt-comment:c1", semanticKey: "comment:c1" } })) as ElementRead;
    expect(el).toMatchObject({ found: true, inViewport: true, highlighted: true });
  });

  it("stop while comments load cancels the action and drops queued commands", async () => {
    rt.onText("Znajdź komentarze.");
    rt.onText("Pierwszy komentarz.");
    await sleep(120);
    rt.onText("stop");
    await rt.idle();
    expect(cancels).toBe(1);
    const find = Object.values(kernel.state.tasks).find((t) => t.kind === "findCollection")!;
    expect(find.status).toBe("cancelled");
    expect(Object.values(kernel.state.tasks).some((t) => t.kind === "focusItem")).toBe(false);
  });

  it("nie ten, następny amends the focus task and highlights the second comment", async () => {
    rt.onText("Znajdź komentarze.");
    const first = rt.onText("Pierwszy komentarz.");
    const next = rt.onText("nie ten, następny");
    await rt.idle();
    expect(next.route).toBe("amend");
    expect(next.result?.taskId).toBe(first.result?.taskId);
    const el = (await browser.read({ kind: "element", target: { ref: "yt-comment:c2", semanticKey: "comment:c2" } })) as ElementRead;
    expect(el.highlighted).toBe(true);
  });

  it("after opening another video, copying the old selection is refused", async () => {
    for (const t of ["Znajdź komentarze.", "Pierwszy komentarz.", "Zaznacz pierwsze cztery litery."]) rt.onText(t);
    await rt.idle();
    rt.onText("Wejdź na YouTube.");
    rt.onText("Otwórz drugi film.");
    await rt.idle();
    const copy = rt.onText("Skopiuj.");
    await rt.idle();
    expect(copy.result?.truth).toBe("BLOCKED");
    const clip = (await browser.read({ kind: "clipboard" })) as ClipboardRead;
    expect(clip.text ?? "").not.toBe("Łódź");
  });

  it("an ambiguous 'komentarz o Łodzi' draws numbered badges, asks, and the answer is verified", async () => {
    const page = () => (browser as unknown as { page: { evaluate: <T>(fn: () => T) => Promise<T> } }).page;
    const badges = () => page().evaluate(() => Array.from(document.querySelectorAll(".jarvis-badge")).map((b) => (b as HTMLElement).style.display === "none" ? "" : b.textContent));
    rt.onText("Znajdź komentarze.");
    await rt.idle();
    const t = rt.onText("Pokaż komentarz o Łodzi.");
    const t0 = Date.now();
    while (!rt.session.hasPendingQuestion()) {
      if (Date.now() - t0 > 5000) throw new Error("no question");
      await sleep(20);
    }
    expect(await badges()).toEqual(["1", "2"]);
    expect(said.at(-1)).toMatch(/^Pasuje 2\. Oznaczyłem je numerami\. 1: od @LodzTV/);
    rt.onText("drugi");
    await rt.idle();
    expect(t.result?.truth).toBe("CONFIRMED");
    const el = (await browser.read({ kind: "element", target: { ref: "yt-comment:c8", semanticKey: "comment:c8" } })) as ElementRead;
    expect(el.highlighted).toBe(true);
    expect(await badges()).toEqual([]);
  });
});
