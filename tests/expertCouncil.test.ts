import { describe, it, expect } from "vitest";
import {
  EXPERT_ROLES,
  parseNaradaCommand,
  assessExpertConsensus,
  runExpertCouncil,
  type ExpertRunner,
} from "../src/lib/expertCouncil";

describe("Sprint 2 / Moduł 3 — Rada Ekspertów (Multi-Agent Sparring)", () => {
  it("rozpoznaje hasło głosowe 'Narada:' oraz warianty i odrzuca zwykłe pytania", () => {
    expect(parseNaradaCommand("Narada: czy kupić serwer GPU za 15 tys. zł?")).toBe(
      "czy kupić serwer GPU za 15 tys. zł?",
    );
    expect(parseNaradaCommand("Jarvis, narada: wejście w nowy rynek B2B")).toBe(
      "wejście w nowy rynek B2B",
    );
    expect(parseNaradaCommand("Rada ekspertów: zmiana cennika SaaS")).toBe("zmiana cennika SaaS");
    expect(parseNaradaCommand("Zwołaj naradę leasing samochodu")).toBe("leasing samochodu");
    expect(parseNaradaCommand("Która jest godzina?")).toBeNull();
    expect(parseNaradaCommand("Narada:")).toBeNull();
  });

  it("uruchamia 3 wyspecjalizowane role RÓWNOLEGLE (Promise.all) i syntetyzuje werdykt <= 30 s", async () => {
    expect(EXPERT_ROLES.map((r) => r.id)).toEqual(["engineer", "strategist", "critic"]);

    let inFlight = 0;
    let maxConcurrency = 0;
    const calledSystems: string[] = [];

    const runner: ExpertRunner = async (system) => {
      calledSystems.push(system);
      inFlight += 1;
      maxConcurrency = Math.max(maxConcurrency, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      if (system.includes("Inżynierem")) return "Technicznie wykonalne w 2 tygodnie, uwaga na integrację płatności.";
      if (system.includes("Strategiem")) return "Koszt ok. 12 tys. zł, ROI po 4 miesiącach przy marży 40%.";
      return "Ryzyko: brak potwierdzonego popytu i możliwy poślizg wdrożenia.";
    };

    const synthesizer: ExpertRunner = async (_sys, prompt) => {
      expect(prompt).toContain("Inżynier-Praktyk");
      expect(prompt).toContain("Strateg-Finansista");
      expect(prompt).toContain("Sceptyczny Krytyk");
      return "Warto ruszyć z pilotażem, bo ROI zamyka się w 4 miesiącach. Najpierw zweryfikuj popyt u 5 klientów, zanim wydasz 12 tys. zł. Zrób prosty landing testowy w ten weekend.";
    };

    const res = await runExpertCouncil("Nowa aplikacja B2B", { runner, synthesizer });

    // Dowód prawdziwej równoległości Promise.all: wszystkie 3 wywołania żyły jednocześnie
    expect(maxConcurrency).toBe(3);
    expect(calledSystems).toHaveLength(3);
    expect(res.opinions).toHaveLength(3);
    expect(res.opinions.every((o) => o.ok)).toBe(true);
    expect(res.spokenVerdict.length).toBeLessThanOrEqual(380);
    expect(res.spokenVerdict).not.toContain("**");
    // Karta UI dla Conversation.tsx
    expect(res.council.members).toHaveLength(3);
    expect(res.council.note).toContain("Rada Ekspertów (3/3");
    expect(res.council.consensus).toBe("conflict");
  });

  it("działa odpornie, gdy 1 z 3 ekspertów lub syntezator zwróci błąd", async () => {
    const runner: ExpertRunner = async (system) => {
      if (system.includes("Strategiem")) throw new Error("429 rate limit");
      if (system.includes("Inżynierem")) return "Wykonalne szybko i prosto na obecnym stacku.";
      return "Sprawdź limit API u dostawcy przed uruchomieniem.";
    };
    const failingSynth: ExpertRunner = async () => {
      throw new Error("synth offline");
    };

    const res = await runExpertCouncil("Migracja bazy", { runner, synthesizer: failingSynth });
    expect(res.opinions.filter((o) => o.ok)).toHaveLength(2);
    expect(res.opinions.find((o) => o.id === "strategist")?.ok).toBe(false);
    expect(res.verdict).toBeTruthy();
    expect(res.spokenVerdict).toBeTruthy();
    expect(res.council.note).toContain("2/3");
  });

  it("poprawnie ocenia konsensus opinii", () => {
    expect(
      assessExpertConsensus([
        { id: "engineer", label: "E", text: "Wykonalne szybko i proste.", ok: true, ms: 5 },
        { id: "strategist", label: "S", text: "Wysoki ROI i dobry zysk.", ok: true, ms: 5 },
        { id: "critic", label: "C", text: "Brak istotnych barier.", ok: true, ms: 5 },
      ]),
    ).toBe("full");
  });
});
