// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// Na web (nie-Android) plugin nie istnieje — most ma działać łagodnie, bez wyjątków.
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "web", isNativePlatform: () => false },
  registerPlugin: () => ({
    isEnabled: async () => ({ enabled: false }),
    openAccessibilitySettings: async () => {},
    type: async () => ({ ok: false }),
    tap: async () => ({ ok: false }),
    global: async () => ({ ok: false }),
    openApp: async () => ({ ok: false }),
    openSettings: async () => ({ ok: false }),
    launch: async () => ({ ok: false }),
  }),
}));

import { systemActionsAvailable, saIsEnabled, saType, saTap, saOpenApp } from "../src/lib/systemActions";

describe("systemActions — łagodne na web (bez Androida)", () => {
  it("niedostępne na web", () => {
    expect(systemActionsAvailable()).toBe(false);
  });
  it("saIsEnabled → false, bez wyjątku", async () => {
    expect(await saIsEnabled()).toBe(false);
  });
  it("akcje zwracają czytelną informację zamiast rzucać", async () => {
    expect(await saType("cześć")).toMatch(/Androidzie/i);
    expect(await saTap(10, 20)).toMatch(/Androidzie/i);
    expect(await saOpenApp("WhatsApp")).toMatch(/Androidzie/i);
  });
});
