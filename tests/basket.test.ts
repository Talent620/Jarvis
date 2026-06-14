import { describe, it, expect } from "vitest";
import { parseItems, basketSummary, type BasketLine } from "../src/lib/basket";
import type { Offer } from "../src/lib/bargain";

const offer = (price: number, currency = "PLN"): Offer => ({
  title: "X", price, currency, condition: "new", source: "A", url: "https://a/1",
});

describe("parseItems", () => {
  it("dzieli po nowych liniach, przecinkach i średnikach", () => {
    expect(parseItems("mleko\nchleb, masło; jajka")).toEqual(["mleko", "chleb", "masło", "jajka"]);
  });
  it("usuwa puste i duplikaty (bez względu na wielkość liter)", () => {
    expect(parseItems("Mleko, mleko,  , chleb")).toEqual(["Mleko", "chleb"]);
  });
  it("ogranicza do 15 pozycji", () => {
    const many = Array.from({ length: 20 }, (_, i) => `poz${i}`).join(",");
    expect(parseItems(many)).toHaveLength(15);
  });
  it("pusty tekst → pusta lista", () => {
    expect(parseItems("   ")).toEqual([]);
  });
});

describe("basketSummary", () => {
  it("sumuje najtańsze i liczy znalezione/brakujące", () => {
    const lines: BasketLine[] = [
      { query: "a", best: offer(100), offers: 3 },
      { query: "b", best: offer(50), offers: 2 },
      { query: "c", best: null, offers: 0 },
    ];
    const s = basketSummary(lines);
    expect(s.total).toBe(150);
    expect(s.found).toBe(2);
    expect(s.missing).toBe(1);
    expect(s.currency).toBe("PLN");
  });
  it("pusty koszyk → zera", () => {
    const s = basketSummary([]);
    expect(s.total).toBe(0);
    expect(s.found).toBe(0);
    expect(s.missing).toBe(0);
  });
  it("ignoruje pozycje z ceną 0", () => {
    const lines: BasketLine[] = [{ query: "a", best: offer(0), offers: 1 }];
    expect(basketSummary(lines).missing).toBe(1);
  });
});
