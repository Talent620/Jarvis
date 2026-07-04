import { describe, it, expect } from "vitest";
import { mergeById } from "../src/lib/store";

// Reprodukcja wyniku race condition A1: zapis do RAM W TRAKCIE async hydratacji NIE może
// kasować danych zapisanych w IndexedDB (ani odwrotnie). Sercem naprawy jest scalenie po id.

describe("store — mergeById (atomowość A1: brak lost-update przy hydratacji)", () => {
  it("RAM (1 nowy fakt) + persisted (100 zapisanych) → 101, NIC nie ginie", () => {
    const ram = [{ id: "new", v: "świeży wpis dodany w trakcie startu" }];
    const persisted = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, v: i }));
    const merged = mergeById(ram, persisted);
    expect(merged).toHaveLength(101); // dawniej guard zostawiał 1 i kasował 100 → tu zachowane oba
    expect(merged.some((x) => x.id === "new")).toBe(true);
    expect(merged.filter((x) => x.id.startsWith("p"))).toHaveLength(100);
  });

  it("przy kolizji id wygrywa primary (RAM = nowsze)", () => {
    const merged = mergeById([{ id: "a", v: "nowe" }], [{ id: "a", v: "stare" }, { id: "b", v: "z dysku" }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((x) => x.id === "a")?.v).toBe("nowe");
    expect(merged.find((x) => x.id === "b")?.v).toBe("z dysku");
  });

  it("RAM puste → bierze całość z dysku; persisted puste → zostaje RAM", () => {
    expect(mergeById([], [{ id: "x" }])).toEqual([{ id: "x" }]);
    expect(mergeById([{ id: "y" }], [])).toEqual([{ id: "y" }]);
  });

  it("rekordy bez id są zachowane (nie gubione przez dedup)", () => {
    const merged = mergeById([{ v: 1 } as { id?: string }], [{ v: 2 } as { id?: string }]);
    expect(merged).toHaveLength(2);
  });

  it("odporne na null/undefined wejście", () => {
    expect(mergeById(undefined as never, [{ id: "z" }])).toEqual([{ id: "z" }]);
    expect(mergeById([{ id: "z" }], undefined as never)).toEqual([{ id: "z" }]);
  });
});
