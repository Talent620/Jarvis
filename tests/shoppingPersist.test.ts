import { describe, it, expect } from "vitest";
import { shoppingToText, syncShoppingItems, parseItems } from "../src/lib/basket";
import type { ShoppingItem } from "../src/types";

let n = 0;
const uid = () => `id${++n}`;

describe("Lista zakupów — trwałość (czyste adaptery)", () => {
  it("shoppingToText: nazwy w liniach, z ilością gdy jest", () => {
    const items: ShoppingItem[] = [
      { id: "a", name: "mleko", done: false, createdAt: 1 },
      { id: "b", name: "jajka", qty: "10", done: true, createdAt: 2 },
    ];
    expect(shoppingToText(items)).toBe("mleko\n10 jajka");
    expect(shoppingToText(undefined)).toBe("");
  });

  it("syncShoppingItems tworzy nowe pozycje dla nowych nazw", () => {
    n = 0;
    const out = syncShoppingItems([], parseItems("mleko\nchleb"), uid, 100);
    expect(out.map((x) => x.name)).toEqual(["mleko", "chleb"]);
    expect(out.every((x) => x.done === false)).toBe(true);
    expect(out[0].createdAt).toBe(100);
  });

  it("zachowuje id / done / createdAt istniejących pozycji (po nazwie)", () => {
    const prev: ShoppingItem[] = [{ id: "keep", name: "Mleko", done: true, createdAt: 5 }];
    const out = syncShoppingItems(prev, parseItems("mleko\nchleb"), uid, 200);
    const mleko = out.find((x) => x.name.toLowerCase() === "mleko")!;
    expect(mleko.id).toBe("keep");
    expect(mleko.done).toBe(true); // odhaczenie nie ginie
    expect(mleko.createdAt).toBe(5);
  });

  it("usuwa pozycje skreślone z tekstu i dedupuje powtórki", () => {
    const prev: ShoppingItem[] = [
      { id: "1", name: "mleko", done: false, createdAt: 1 },
      { id: "2", name: "chleb", done: false, createdAt: 1 },
    ];
    const out = syncShoppingItems(prev, parseItems("mleko\nmleko"), uid, 300);
    expect(out.map((x) => x.name)).toEqual(["mleko"]); // chleb usunięty, duplikat scalony
  });

  it("round-trip: tekst → items → tekst jest stabilny", () => {
    n = 0;
    const items = syncShoppingItems([], parseItems("wiertarka\nopona"), uid, 1);
    expect(shoppingToText(items)).toBe("wiertarka\nopona");
  });
});
