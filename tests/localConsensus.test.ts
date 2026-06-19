import { describe, it, expect, vi } from "vitest";
import { mostConsistent, localSelfConsistency } from "../src/lib/localConsensus";
import type { JarvisReply } from "../src/lib/providers/types";

const reply = (text: string): JarvisReply => ({ text }) as JarvisReply;

describe("localConsensus — mostConsistent", () => {
  it("wybiera odpowiedź zgodną z większością (odrzuca odstającą)", () => {
    // Dwie podobne (Warszawa) + jedna odstająca (Kraków) → centroid = jedna z dwóch zgodnych.
    const cands = [
      "Stolicą Polski jest Warszawa nad Wisłą",
      "Warszawa to stolica Polski nad Wisłą",
      "Stolicą Polski jest Kraków w Małopolsce zupełnie inaczej",
    ];
    const idx = mostConsistent(cands);
    expect(idx === 0 || idx === 1).toBe(true);
    expect(cands[idx]).toMatch(/Warszawa/);
  });
  it("jedna kandydatka → indeks 0", () => {
    expect(mostConsistent(["x"])).toBe(0);
  });
});

describe("localConsensus — localSelfConsistency", () => {
  it("zbiera dodatkowe próbki i wybiera spójną (większość)", async () => {
    const seq = ["Warszawa to stolica Polski", "Kraplak losowy odjazd zupełnie inny temat"];
    let i = 0;
    const run = vi.fn(() => Promise.resolve(reply(seq[i++])));
    const r = await localSelfConsistency({ first: reply("Stolicą Polski jest Warszawa"), run, extra: 2 });
    expect(r.samples).toBe(3);
    expect(r.reply.text).toMatch(/Warszawa/);
  });

  it("extra=0 → zostaje pierwsza, bez wołania run", async () => {
    const run = vi.fn();
    const r = await localSelfConsistency({ first: reply("jedyna"), run, extra: 0 });
    expect(r.samples).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("błędy prób są pomijane (graceful)", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("padło"))
      .mockResolvedValueOnce(reply("druga odpowiedź sensowna"));
    const r = await localSelfConsistency({ first: reply("pierwsza odpowiedź sensowna"), run, extra: 2 });
    expect(r.samples).toBe(2); // pierwsza + jedna udana (jedna padła)
  });

  it("puste teksty prób nie są liczone", async () => {
    const run = vi.fn(() => Promise.resolve(reply("   ")));
    const r = await localSelfConsistency({ first: reply("realna"), run, extra: 3 });
    expect(r.samples).toBe(1);
    expect(r.reply.text).toBe("realna");
  });
});
