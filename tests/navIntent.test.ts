import { describe, it, expect } from "vitest";
import { resolveScreen, requestScreen, onScreenRequest, SCREENS } from "../src/lib/navIntent";

describe("navIntent — resolveScreen (czat → moduł)", () => {
  it("dopasowuje po nazwie i aliasach PL", () => {
    expect(resolveScreen("Finanse")?.id).toBe("finance");
    expect(resolveScreen("otwórz studio obrazów")?.id).toBe("studio");
    expect(resolveScreen("pokaż reklamy")?.id).toBe("ads");
    expect(resolveScreen("przejdź do ustawień... ustawienia")?.id).toBe("settings");
    expect(resolveScreen("kreator stron")?.id).toBe("web");
    expect(resolveScreen("pieniądze")?.id).toBe("finance");
  });
  it("dokładne dopasowanie ma pierwszeństwo nad częściowym", () => {
    expect(resolveScreen("mail")?.id).toBe("mail");
  });
  it("nieznany moduł → null", () => {
    expect(resolveScreen("xyz nic takiego")).toBeNull();
    expect(resolveScreen("")).toBeNull();
  });
  it("każdy ekran ma id, etykietę i aliasy", () => {
    for (const s of SCREENS) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(Array.isArray(s.aliases)).toBe(true);
    }
  });
});

describe("navIntent — pub/sub", () => {
  it("requestScreen powiadamia subskrybentów; unsubscribe odpina", () => {
    const got: string[] = [];
    const off = onScreenRequest((id) => got.push(id));
    requestScreen("finance");
    requestScreen("studio");
    expect(got).toEqual(["finance", "studio"]);
    off();
    requestScreen("mail");
    expect(got).toEqual(["finance", "studio"]); // po odpięciu już nie dostaje
  });
  it("błąd jednego listenera nie blokuje pozostałych", () => {
    let ok = 0;
    const offBad = onScreenRequest(() => { throw new Error("zły"); });
    const offGood = onScreenRequest(() => { ok++; });
    expect(() => requestScreen("finance")).not.toThrow();
    expect(ok).toBe(1);
    offBad(); offGood();
  });
});

describe("navIntent — narzędzie open_screen zarejestrowane", () => {
  it("open_screen jest w toolDefs", async () => {
    const { toolDefs } = await import("../src/lib/tools");
    expect(toolDefs.some((d) => d.name === "open_screen")).toBe(true);
  });
});
