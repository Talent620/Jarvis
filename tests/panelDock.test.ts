import { describe, it, expect } from "vitest";
import { normalizeDock, dockBodyClass, cycleDock, DOCK_OPTIONS, DOCK_CLASSES } from "../src/lib/panelDock";

// Dokowanie paneli: mapowanie wyboru → klasa body. Testy pilnują odporności (śmieć → center)
// i spójności cyklu przełącznika.

describe("panelDock — czysta logika dokowania", () => {
  it("normalizeDock: tylko left/right przechodzą, reszta → center", () => {
    expect(normalizeDock("left")).toBe("left");
    expect(normalizeDock("right")).toBe("right");
    expect(normalizeDock("center")).toBe("center");
    expect(normalizeDock("cokolwiek")).toBe("center");
    expect(normalizeDock(undefined)).toBe("center");
    expect(normalizeDock(null)).toBe("center");
  });
  it("dockBodyClass: center → pusto; left/right → dock-*", () => {
    expect(dockBodyClass("center")).toBe("");
    expect(dockBodyClass("left")).toBe("dock-left");
    expect(dockBodyClass("right")).toBe("dock-right");
    expect(dockBodyClass("śmieć" as never)).toBe(""); // odporność
  });
  it("DOCK_CLASSES pokrywa dokładnie warianty niecentralne (do czyszczenia body)", () => {
    expect([...DOCK_CLASSES].sort()).toEqual(["dock-left", "dock-right"]);
  });
  it("cycleDock: lewo → środek → prawo → lewo", () => {
    expect(cycleDock("left")).toBe("center");
    expect(cycleDock("center")).toBe("right");
    expect(cycleDock("right")).toBe("left");
  });
  it("DOCK_OPTIONS ma trzy opcje z ikoną i etykietą", () => {
    expect(DOCK_OPTIONS.map((o) => o.id)).toEqual(["left", "center", "right"]);
    for (const o of DOCK_OPTIONS) { expect(o.icon.length).toBeGreaterThan(0); expect(o.label.length).toBeGreaterThan(0); }
  });
});
