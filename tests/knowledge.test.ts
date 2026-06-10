import { describe, it, expect } from "vitest";
import { retrieveKnowledge, KNOWLEDGE } from "../src/lib/knowledge";

describe("wiedza ekspercka (retrieveKnowledge)", () => {
  it("dobiera trafne modele mentalne do tematu", () => {
    const fin = retrieveKnowledge("jak inwestować pieniądze i oszczędzać na przyszłość");
    expect(fin).toMatch(/Procent składany|Fundusz awaryjny|Dywersyf/i);

    const neg = retrieveKnowledge("mam negocjować podwyżkę pensji w pracy");
    expect(neg).toMatch(/BATNA|negocjac/i);

    const prod = retrieveKnowledge("jak być bardziej produktywnym i ustalać priorytety");
    expect(prod).toMatch(/Pareto|Eisenhower|priorytet/i);
  });

  it("zwraca pusto dla zapytań bez sensownych słów", () => {
    expect(retrieveKnowledge("ok")).toBe("");
    expect(retrieveKnowledge("")).toBe("");
  });

  it("ogranicza liczbę wkładek (max 3 domyślnie)", () => {
    const out = retrieveKnowledge("decyzja ryzyko pieniądze produktywność nauka negocjacje zdrowie");
    expect((out.match(/\n- /g) || []).length).toBeLessThanOrEqual(3);
  });

  it("baza ma sensowny rozmiar i strukturę", () => {
    expect(KNOWLEDGE.length).toBeGreaterThanOrEqual(20);
    for (const k of KNOWLEDGE) {
      expect(k.title.length).toBeGreaterThan(2);
      expect(k.body.length).toBeGreaterThan(20);
    }
  });
});
