import { describe, it, expect } from "vitest";
import { shouldRoute, runtimeAvailable, tryRuntimeCommand } from "../../src/lib/runtime/appRuntime";
import { parseCommand } from "../../src/lib/runtime/commands";
import { Kernel } from "../../src/lib/runtime/kernel";

describe("app runtime routing", () => {
  it("is off outside the desktop app (web, mobile, tests)", async () => {
    expect(runtimeAvailable()).toBe(false);
    expect(await tryRuntimeCommand("uruchom przeglądarkę")).toBeNull();
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
