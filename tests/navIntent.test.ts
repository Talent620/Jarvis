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

describe("navIntent — pełne pokrycie i klasyfikacja zgód", () => {
  it("każdy z 9 modułów biznesowych rozpoznaje się po samym id", () => {
    for (const id of ["sales", "finance", "mail", "sent", "content", "ads", "brand", "web", "money"]) {
      expect(resolveScreen(id)?.id).toBe(id);
    }
  });

  it("rozpoznaje nowo dodane ekrany sterowania (cel, recall, dane, historia)", () => {
    expect(resolveScreen("zleć cel")?.id).toBe("goal");
    expect(resolveScreen("recall")?.id).toBe("recall");
    expect(resolveScreen("kopia zapasowa")?.id).toBe("data");
    expect(resolveScreen("historia rozmów")?.id).toBe("history");
  });

  it("każdy ekran SCREENS ma unikalne id", () => {
    const ids = SCREENS.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("Gdzie kupić i Lista zakupów są osiągalne głosem/czatem (dawniej tylko z kafla)", () => {
    expect(resolveScreen("gdzie kupić")?.id).toBe("whereToBuy");
    expect(resolveScreen("gdzie kupic tanio")?.id).toBe("whereToBuy");
    expect(resolveScreen("lista zakupów")?.id).toBe("shoppingList");
    expect(resolveScreen("zakupy")?.id).toBe("shoppingList");
  });

  it("open_screen jest sklasyfikowane jako read (lokalna nawigacja, bez zgody outbound)", async () => {
    const { riskOf } = await import("../src/lib/permissions");
    expect(riskOf("open_screen")).toBe("read");
    expect(riskOf("finance_summary")).toBe("read");
    expect(riskOf("project_knowledge")).toBe("read");
    expect(riskOf("finance_add_project")).toBe("write");
    expect(riskOf("finance_set_status")).toBe("write");
  });
});
