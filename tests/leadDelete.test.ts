import { describe, it, expect } from "vitest";
import { removeLead, restoreLead } from "../src/lib/leadDelete";
import type { Lead } from "../src/types";

function lead(id: string, company: string): Lead {
  return { id, company, status: "new", createdAt: 1, updatedAt: 1 } as Lead;
}

describe("leadDelete — usuń z możliwością cofnięcia", () => {
  const base = [lead("a", "Alfa"), lead("b", "Beta"), lead("c", "Gamma")];

  it("removeLead usuwa właściwy rekord i podaje pozycję", () => {
    const r = removeLead(base, "b");
    expect(r.removed?.id).toBe("b");
    expect(r.index).toBe(1);
    expect(r.next.map((l) => l.id)).toEqual(["a", "c"]);
    expect(base.map((l) => l.id)).toEqual(["a", "b", "c"]); // nie mutuje wejścia
  });

  it("removeLead na nieistniejącym id → removed null, lista bez zmian", () => {
    const r = removeLead(base, "zzz");
    expect(r.removed).toBeNull();
    expect(r.index).toBe(-1);
    expect(r.next.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("restoreLead wstawia z powrotem w oryginalne miejsce", () => {
    const r = removeLead(base, "b");
    const back = restoreLead(r.next, r.removed, r.index);
    expect(back.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("restoreLead jest idempotentne — nie duplikuje gdy lead już wrócił", () => {
    const r = removeLead(base, "a");
    const once = restoreLead(r.next, r.removed, r.index);
    const twice = restoreLead(once, r.removed, r.index);
    expect(twice.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("restoreLead z null → lista bez zmian", () => {
    expect(restoreLead(base, null, 0).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("przywraca na koniec gdy indeks większy niż długość (lista skurczyła się)", () => {
    const r = removeLead(base, "c"); // index 2
    const shrunk = r.next.slice(0, 1); // ["a"]
    const back = restoreLead(shrunk, r.removed, r.index);
    expect(back.map((l) => l.id)).toEqual(["a", "c"]);
  });
});
