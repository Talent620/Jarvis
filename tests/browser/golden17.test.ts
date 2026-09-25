// Golden scenario, steps 1-7 (mission M2) on the YouTube fixture with a real Chromium and the
// same runtime as production: Kernel + ActionSession + ManagedBrowser. Every step must be
// CONFIRMED by read-back; the test re-reads the page itself instead of trusting the session.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../../src/lib/runtime/kernel";
import { ActionSession, type TurnResult } from "../../src/lib/runtime/session";
import { ManagedBrowser } from "../../src/node/managedBrowser";
import { createEnvHost } from "../../src/node/envHost";
import { IpcEnvironment, type EnvBridge } from "../../src/lib/runtime/env/ipc";
import type { ClipboardRead, ComputerEnvironment, PageRead, SelectionRead } from "../../src/lib/runtime/env/types";
// @ts-expect-error plain ESM fixture without types
import { startYoutubeFixture } from "../fixtures/youtube/server.mjs";
import { findChromium } from "./chromium";

export interface GoldenRun {
  turns: { text: string; result: TurnResult; ms: number }[];
  clipboard: string;
  selection: string;
  url: string;
  kernel: Kernel;
}

/** Production path in the desktop app: renderer proxy -> JSON (structured clone) -> main host. */
export function viaIpc(browser: ManagedBrowser): ComputerEnvironment {
  const host = createEnvHost(browser);
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const bridge: EnvBridge = {
    call: async (req) => clone(await host.handle(clone(req))),
    onEvent: (cb) => browser.onEvent((e) => cb(clone(e))),
  };
  return new IpcEnvironment(browser.id, bridge);
}

export async function runGolden17(opts: { rerenderMs?: number; ipc?: boolean } = {}): Promise<GoldenRun> {
  const fixture = await startYoutubeFixture({ rerenderMs: opts.rerenderMs ?? 2500 });
  const profile = mkdtempSync(join(tmpdir(), "jarvis-profile-"));
  const browser = new ManagedBrowser({ userDataDir: profile, executablePath: findChromium(), headless: true });
  const env = opts.ipc ? viaIpc(browser) : browser;
  const kernel = new Kernel();
  const session = new ActionSession(kernel, env, { youtubeUrl: `${fixture.url}/` });
  const turns: GoldenRun["turns"] = [];
  try {
    await session.start();
    const utterances = [
      "Jarvis, uruchom przeglądarkę.",
      "Wejdź na YouTube.",
      "Otwórz pierwszy film.",
      "Zjedź trochę niżej.",
      "Znajdź komentarze.",
      "Pierwszy komentarz.",
      "Zaznacz pierwsze cztery litery.",
      "Skopiuj.",
    ];
    for (const text of utterances) {
      const t0 = Date.now();
      const result = await session.handle(text);
      turns.push({ text, result, ms: Date.now() - t0 });
      if (result.truth !== "CONFIRMED") break;
    }
    const clip = (await env.read({ kind: "clipboard" })) as ClipboardRead;
    const sel = (await env.read({ kind: "selection" })) as SelectionRead;
    const page = (await env.read({ kind: "page" })) as PageRead;
    return { turns, clipboard: clip.text ?? "", selection: sel.text, url: page.url ?? "", kernel };
  } finally {
    session.stop();
    await browser.close();
    await fixture.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

function assertGolden(run: GoldenRun): void {
  const summary = run.turns.map((t) => `${t.result.truth} ${t.text} -> ${t.result.say} [${t.result.evidence ?? ""}]`).join("\n");
  expect(run.turns.map((t) => t.result.truth), summary).toEqual(Array(8).fill("CONFIRMED"));
  const [launch, yt, film, scroll, find, first, select, copy] = run.turns.map((t) => t.result);
  expect(launch.command).toBe("browser.launch");
  expect(yt.say).toContain("Odrzuciłem dodatkowe ciasteczka");
  expect(film.command).toBe("browser.openItem");
  expect(run.url).toMatch(/\/watch\?v=lodz$/);
  expect(scroll.evidence).toMatch(/scrollY \d+ -> \d+/);
  expect(find.command).toBe("findCollection");
  expect(first.say).toContain("Pierwszy komentarz (przypięty), od @LodzTV");
  expect(select.data?.selection).toBe("Łódź");
  expect(copy.data?.clipboard).toBe("Łódź");
  // Independent read-backs from the page itself.
  expect(run.clipboard).toBe("Łódź");
  const k = run.kernel.state;
  expect(k.clipboard).toMatchObject({ byJarvis: true, preview: "Łódź", provenance: "UNTRUSTED_WEB" });
  // Every action ended CONFIRMED with evidence; nothing is left started or unknown.
  const actions = Object.values(k.actions);
  expect(actions.length).toBeGreaterThanOrEqual(9);
  expect(actions.filter((a) => a.status !== "CONFIRMED")).toEqual([]);
  expect(actions.every((a) => !!a.evidence)).toBe(true);
  // Every task is done.
  expect(Object.values(k.tasks).map((t) => t.status)).toEqual(Array(8).fill("done"));
}

describe("golden scenario steps 1-7 on the YouTube fixture", () => {
  it("runs every step with read-back confirmation", async () => {
    const run = await runGolden17();
    assertGolden(run);
  });

  it("runs through the Electron IPC proxy exactly like in-process", async () => {
    assertGolden(await runGolden17({ ipc: true }));
  });

  it("survives aggressive list re-renders (every 150 ms) between resolve, select and copy", async () => {
    for (let i = 0; i < 5; i++) assertGolden(await runGolden17({ rerenderMs: 150 }));
  });

  it("10 consecutive green runs (mission M2 DoD)", async () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      const run = await runGolden17({ rerenderMs: 1500 + i * 150 });
      assertGolden(run);
      times.push(Date.now() - t0);
    }
    console.log(`golden17 x10 ms: ${times.join(", ")}`);
  }, 600_000);
});
