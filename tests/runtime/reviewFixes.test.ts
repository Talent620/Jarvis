// Regression tests for the adversarial review of M1-M3 (findings H1-H4, M1-M10).
import { describe, it, expect } from "vitest";
import { verify } from "../../src/lib/runtime/postconditions";
import { IpcEnvironment } from "../../src/lib/runtime/env/ipc";
import { Kernel } from "../../src/lib/runtime/kernel";
import type { ActResult, EnvAction } from "../../src/lib/runtime/env/types";

const done: ActResult = { status: "done" };

describe("H1: a failed read is never a confirmed postcondition", () => {
  it("IPC failed envelopes are thrown by read/capabilities/snapshot", async () => {
    const env = new IpcEnvironment("x", { call: async () => ({ status: "failed", error: "Target closed" }), onEvent: () => () => {} });
    await expect(env.read({ kind: "page" })).rejects.toThrow("Target closed");
    await expect(env.capabilities()).rejects.toThrow("Target closed");
    await expect(env.snapshot()).rejects.toThrow("Target closed");
  });

  it("scroll up/start with an unreadable or closed page is not CONFIRMED", () => {
    const up: EnvAction = { kind: "browser.scroll", direction: "up", amount: "page" };
    const start: EnvAction = { kind: "browser.scroll", direction: "up", amount: "start" };
    const before = { open: true, scrollY: 1200, viewportHeight: 800, documentHeight: 4000 };
    for (const after of [{ open: false }, { open: true }, { status: "failed", error: "x" } as never]) {
      expect(verify(up, before, after, done, 0).truth).not.toBe("CONFIRMED");
      expect(verify(start, before, after, done, 0).truth).not.toBe("CONFIRMED");
    }
    expect(verify(up, before, { ...before, scrollY: 400 }, done, 0).truth).toBe("CONFIRMED");
  });

  it("consent is gone only on an open page off the consent host", () => {
    const a: EnvAction = { kind: "browser.consent", choice: "reject" };
    expect(verify(a, undefined, { open: false }, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, undefined, { status: "failed", error: "x" } as never, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, undefined, { open: true, url: "https://consent.youtube.com/m", consentWall: false }, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, undefined, { open: true, url: "https://www.youtube.com/", consentWall: false }, done, 0).truth).toBe("CONFIRMED");
  });

  it("open needs a known before URL and must land on the target's own link (H2)", () => {
    const a: EnvAction = { kind: "browser.open", target: { ref: "yt-video:/watch?v=lodz", semanticKey: "video:/watch?v=lodz" } };
    expect(verify(a, undefined, { open: true, url: "https://yt/watch?v=lodz" }, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, { open: true, url: "https://yt/" }, { open: true, url: "https://yt/watch?v=other" }, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, { open: true, url: "https://yt/" }, { open: true, url: "https://yt/watch?v=lodz" }, done, 0).truth).toBe("CONFIRMED");
  });

  it("a malformed capabilities event is ignored instead of throwing in dispatch", () => {
    const k = new Kernel();
    expect(() => k.dispatch({ type: "CapabilitiesUpdated", capabilities: { status: "failed" } as never })).not.toThrow();
    expect(k.state.capabilities).toEqual({});
  });
});
