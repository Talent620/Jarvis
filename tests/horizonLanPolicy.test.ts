import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

// Przejście loopback→LAN za jawną zgodą — testy adwersarialne polityki bindu.
// Twarde bariery: LAN tylko przy allowLan ORAZ paired ORAZ adresie prywatnym;
// 0.0.0.0, „*" i publiczny IP → NIGDY (nawet ze zgodą).
const require = createRequire(import.meta.url);
const core = require("../electron/horizon-listener-core.cjs");
const { resolveBindPolicy, isPrivateLanAddress } = core;

describe("isPrivateLanAddress — RFC1918/link-local", () => {
  it("prywatne → true", () => {
    for (const h of ["192.168.1.50", "10.0.0.5", "172.16.0.1", "172.31.255.254", "169.254.1.2"]) {
      expect(isPrivateLanAddress(h)).toBe(true);
    }
  });
  it("publiczne / specjalne → false", () => {
    for (const h of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "0.0.0.0", "*", "", "example.com"]) {
      expect(isPrivateLanAddress(h)).toBe(false);
    }
  });
});

describe("resolveBindPolicy — kontrolowane wyjście na LAN", () => {
  const full = { allowLan: true, paired: true };

  it("loopback zawsze OK, niezależnie od zgody", () => {
    expect(resolveBindPolicy("127.0.0.1", {}).host).toBe("127.0.0.1");
    expect(resolveBindPolicy("localhost", {}).host).toBe("127.0.0.1");
  });

  it("prywatny LAN + zgoda + parowanie → dozwolony", () => {
    expect(resolveBindPolicy("192.168.1.50", full)).toEqual({ host: "192.168.1.50" });
    expect(resolveBindPolicy("10.0.0.7", full)).toEqual({ host: "10.0.0.7" });
  });

  it("0.0.0.0 i „*” → NIGDY, nawet z pełną zgodą (zbyt szeroka ekspozycja)", () => {
    expect(resolveBindPolicy("0.0.0.0", full).host).toBeNull();
    expect(resolveBindPolicy("*", full).host).toBeNull();
    expect(resolveBindPolicy("0.0.0.0", full).reason).toMatch(/wszystkie interfejsy/);
  });

  it("publiczny IP → NIGDY, nawet z pełną zgodą", () => {
    const r = resolveBindPolicy("8.8.8.8", full);
    expect(r.host).toBeNull();
    expect(r.reason).toMatch(/nie jest prywatny/);
  });

  it("LAN bez jawnej zgody → odmowa", () => {
    const r = resolveBindPolicy("192.168.1.50", { allowLan: false, paired: true });
    expect(r.host).toBeNull();
    expect(r.reason).toMatch(/jawnej zgody/);
  });

  it("LAN bez parowania → odmowa (HMAC wymagany na LAN)", () => {
    const r = resolveBindPolicy("192.168.1.50", { allowLan: true, paired: false });
    expect(r.host).toBeNull();
    expect(r.reason).toMatch(/parowania/);
  });
});
