import { describe, it, expect } from "vitest";
import { detectDecision, decisionKey, decisionValue } from "../src/lib/decisions";

describe("detectDecision — 🧠 łapanie decyzji i zobowiązań (lokalnie)", () => {
  it("wykrywa klasyczne decyzje", () => {
    expect(detectDecision("Postanowiłem zmienić dostawcę hostingu")?.statement).toMatch(/Postanowi/);
    expect(detectDecision("zdecydowałem, że wchodzę w ten projekt")).not.toBeNull();
    expect(detectDecision("zobowiązuję się dokończyć ofertę")).not.toBeNull();
  });

  it("wyłuskuje termin, gdy jest", () => {
    const d = detectDecision("Decyduję się wysłać ofertę do piątku");
    expect(d).not.toBeNull();
    expect(d!.due).toMatch(/pi[aą]tku/i);
  });

  it("ignoruje zwykłe zdania i pytania", () => {
    expect(detectDecision("jak leci?")).toBeNull();
    expect(detectDecision("opowiedz mi o Rzymie")).toBeNull();
    expect(detectDecision("czy mam zdecydować dzisiaj?")).toBeNull();
    expect(detectDecision("ok")).toBeNull();
  });

  it("bierze zdanie z decyzją z dłuższej wypowiedzi", () => {
    const d = detectDecision("Myślałem nad tym długo. Postanowiłem przejść na abonament roczny. Tyle.");
    expect(d).not.toBeNull();
    expect(d!.statement).toMatch(/abonament roczny/i);
    expect(d!.statement).not.toMatch(/Tyle/);
  });

  it("klucz i wartość pamięci są zwięzłe i sensowne", () => {
    const d = detectDecision("Decyduję się wysłać ofertę do piątku")!;
    expect(decisionKey(d)).toMatch(/^Decyzja: /);
    expect(decisionKey(d).length).toBeLessThanOrEqual(60);
    expect(decisionValue(d)).toMatch(/termin: /);
  });
});
