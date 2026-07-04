// === Model Centrum wg celów (centerModel) — testy ===
// Sześć celów ma jednoznaczne przeznaczenie, każde stare id pozostaje osiągalne w „Wszystkich funkcjach",
// i nie ma zduplikowanych głównych wejść.
import { describe, it, expect } from "vitest";
import { CENTER_GOALS, CENTER_GROUPS, allCenterIds, duplicateCenterIds, unreachableCenterIds } from "../src/lib/centerModel";

describe("centerModel — sześć celów", () => {
  it("dokładnie sześć celów, unikalne id i etykiety", () => {
    expect(CENTER_GOALS).toHaveLength(6);
    expect(new Set(CENTER_GOALS.map((g) => g.id)).size).toBe(6);
    expect(new Set(CENTER_GOALS.map((g) => g.label)).size).toBe(6);
    expect(CENTER_GOALS.map((g) => g.label)).toEqual(["Dziś", "Klienci", "Praca", "Marketing", "Finanse", "JARVIS"]);
  });

  it("każdy cel otwiera realne id z taksonomii", () => {
    const ids = new Set(allCenterIds());
    for (const g of CENTER_GOALS) expect(ids.has(g.opens)).toBe(true);
  });
});

describe("centerModel — Wszystkie funkcje: bez duplikatów, wszystko osiągalne", () => {
  it("żadne id nie występuje w dwóch grupach naraz", () => {
    expect(duplicateCenterIds()).toEqual([]);
  });

  it("kluczowe stare wejścia pozostają osiągalne (w jakiejś grupie)", () => {
    const required = [
      "growthDay", "candidates", "sales", "finance", "mail", "sent", "money",
      "content", "ads", "brand", "web", "tasks", "projects", "journal", "cards",
      "bargain", "wheretobuy", "shoppinglist", "translator", "transcribe", "hud", "studio",
      "mind", "profile", "memory", "boss", "command", "recall", "goal", "goalStatus",
      "notifications", "status", "guardian", "history", "data", "audit", "costs", "gadgets", "helpfaq", "admin",
    ];
    expect(unreachableCenterIds(required)).toEqual([]);
  });

  it("Marketing jest osobną grupą (treści/reklamy/marka/strony)", () => {
    const mk = CENTER_GROUPS.find((g) => g.title.includes("Marketing"));
    expect(mk?.ids).toEqual(expect.arrayContaining(["content", "ads", "brand", "web"]));
  });

  it("Dane i Pomoc+FAQ scalone: taksonomia ma helpfaq, nie ma osobnych faq/help", () => {
    const ids = new Set(allCenterIds());
    expect(ids.has("helpfaq")).toBe(true);
    expect(ids.has("faq")).toBe(false);
    expect(ids.has("help")).toBe(false);
  });
});
