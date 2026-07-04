import { describe, it, expect } from "vitest";
import { leadTimeline, appendLeadNote } from "../src/lib/leadNotes";

describe("leadNotes — appendLeadNote", () => {
  it("dopisuje notatkę na górę z datą", () => {
    const r = appendLeadNote([], "nie odebrał", 1000);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ at: 1000, text: "nie odebrał" });
    const r2 = appendLeadNote(r, "oddzwonić jutro", 2000);
    expect(r2[0].text).toBe("oddzwonić jutro"); // najnowsza pierwsza
    expect(r2).toHaveLength(2);
  });
  it("pusty tekst nie zmienia listy", () => {
    expect(appendLeadNote([{ at: 1, text: "x" }], "   ", 2)).toHaveLength(1);
  });
});

describe("leadNotes — leadTimeline (migracja starego note)", () => {
  it("łączy stary note jako najstarszy wpis i sortuje najnowsze pierwsze", () => {
    const tl = leadTimeline({ note: "stara notatka", notes: [{ at: 5000, text: "nowa" }], createdAt: 1000 });
    expect(tl).toHaveLength(2);
    expect(tl[0].text).toBe("nowa"); // 5000 > 1000
    expect(tl[1].text).toBe("stara notatka");
  });
  it("nie dubluje, gdy stary note już jest w notes", () => {
    const tl = leadTimeline({ note: "ta sama", notes: [{ at: 9, text: "ta sama" }], createdAt: 1 });
    expect(tl).toHaveLength(1);
  });
  it("pusty stan → pusta oś", () => {
    expect(leadTimeline({ note: "", notes: [], createdAt: 1 })).toEqual([]);
  });
});
