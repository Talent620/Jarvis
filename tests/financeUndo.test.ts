import { describe, it, expect } from "vitest";
import { removeProjectById, restoreProject } from "../src/lib/finance";
import type { FinanceProject } from "../src/types";

const P = (id: string, name = id): FinanceProject => ({ id, name, status: "lead", amount: 0, createdAt: 0, updatedAt: 0 });

describe("finance — cofanie usunięcia projektu (undo)", () => {
  it("usuwa po id i zwraca rekord + pozycję", () => {
    const list = [P("a"), P("b"), P("c")];
    const r = removeProjectById(list, "b");
    expect(r.next.map((x) => x.id)).toEqual(["a", "c"]);
    expect(r.removed?.id).toBe("b");
    expect(r.index).toBe(1);
  });

  it("restore wstawia rekord z powrotem na jego pozycję", () => {
    const r = removeProjectById([P("a"), P("b"), P("c")], "b");
    const back = restoreProject(r.next, r.removed!, r.index);
    expect(back.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("restore jest idempotentne (nie duplikuje, gdy rekord już jest)", () => {
    const list = [P("a"), P("b")];
    expect(restoreProject(list, P("b"), 1).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("usunięcie nieistniejącego id nie zmienia listy", () => {
    const list = [P("a")];
    const r = removeProjectById(list, "zzz");
    expect(r.removed).toBeNull();
    expect(r.next).toEqual(list);
  });

  it("restore poza zakresem indeksu trafia na koniec (bezpiecznie)", () => {
    expect(restoreProject([P("a")], P("x"), 99).map((p) => p.id)).toEqual(["a", "x"]);
  });
});
