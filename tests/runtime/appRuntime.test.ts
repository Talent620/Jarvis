import { describe, it, expect } from "vitest";
import { createAppRuntime, shouldRoute, runtimeAvailable, tryRuntimeText } from "../../src/lib/runtime/appRuntime";
import { parseCommand } from "../../src/lib/runtime/commands";
import { Kernel } from "../../src/lib/runtime/kernel";
import type { EnvBridge } from "../../src/lib/runtime/env/ipc";
import { createEnvHost } from "../../src/node/envHost";
import { MemoryBrowser } from "../helpers/memoryBrowser";

function bridgeTo(env: MemoryBrowser): EnvBridge {
  const host = createEnvHost(env);
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return { call: async (req) => clone(await host.handle(clone(req))), onEvent: (cb) => env.onEvent((e) => cb(clone(e))) };
}

describe("app runtime routing", () => {
  it("is off outside the desktop app (web, mobile, tests)", async () => {
    expect(runtimeAvailable()).toBe(false);
    expect(await tryRuntimeText("uruchom przeglądarkę")).toBeNull();
  });

  it("launch and YouTube always route; referring commands only with something on screen", () => {
    const k = new Kernel();
    expect(shouldRoute(parseCommand("uruchom przeglądarkę"), k.state)).toBe(true);
    expect(shouldRoute(parseCommand("wejdź na YouTube"), k.state)).toBe(true);
    // Chat-like "dalej" / "następny" / "skopiuj" must stay with the chat when nothing is open.
    expect(shouldRoute(parseCommand("dalej"), k.state)).toBe(false);
    expect(shouldRoute(parseCommand("następny"), k.state)).toBe(false);
    expect(shouldRoute(parseCommand("skopiuj"), k.state)).toBe(false);
    expect(shouldRoute(parseCommand("zjedź niżej"), k.state)).toBe(false);

    k.dispatch({ type: "ObservationReceived", env: "b", kind: "navigation", page: { id: "p1", url: "http://x/", title: "X" } });
    expect(shouldRoute(parseCommand("zjedź niżej"), k.state)).toBe(true);
    expect(shouldRoute(parseCommand("następny"), k.state)).toBe(false);
    k.dispatch({ type: "ReferentAdded", referent: { id: "c", type: "Collection", source: "b", scope: "p1", semanticKey: "c", confidence: 1, salience: 1, metadata: {} }, items: [], itemKind: "comment" });
    expect(shouldRoute(parseCommand("następny"), k.state)).toBe(true);
    expect(shouldRoute(parseCommand("skopiuj"), k.state)).toBe(false);
    k.dispatch({ type: "ReferentAdded", referent: { id: "s", type: "Selection", source: "b", scope: "p1", semanticKey: "s", confidence: 1, salience: 1, metadata: { text: "x" } } });
    expect(shouldRoute(parseCommand("skopiuj"), k.state)).toBe(true);
    expect(shouldRoute(parseCommand("a jaka jutro pogoda?"), k.state)).toBe(false);
  });
});

describe("app runtime is the full JarvisRuntime (reflex, status, consent), not a bare session", () => {
  it("claims commands, controls of a running task and announced consents; leaves chat to the chat", async () => {
    const said: string[] = [];
    const { runtime: rt, kernel } = await createAppRuntime(bridgeTo(new MemoryBrowser()), { say: (t) => { said.push(t); }, cancel: () => undefined });
    const claims = (t: string) => rt.claims(t, (cmd) => shouldRoute(cmd, kernel.state));
    expect(claims("a jaka jutro pogoda?")).toBe(false);
    expect(claims("stop")).toBe(false); // nothing running: "stop" is for the chat's own speech
    expect(claims("tak")).toBe(false); // nothing was asked
    expect(claims("co teraz robisz?")).toBe(false);
    expect(claims("uruchom przeglądarkę")).toBe(true);
    const launch = rt.onText("uruchom przeglądarkę");
    expect(claims("stop")).toBe(true);
    expect(claims("co teraz robisz?")).toBe(true);
    await rt.idle();
    expect(launch.result?.truth).toBe("CONFIRMED");
    expect(said.at(-1)).toBe(launch.say);
    rt.stop();
  });
});
