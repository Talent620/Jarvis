import { describe, it, expect } from "vitest";
import { goalDecompositionPrompt, parseGoalPlan } from "../src/lib/goalPlanner";

describe("goalPlanner — prompt dekompozycji", () => {
  it("zawiera cel, limit kroków i format JSON", () => {
    const p = goalDecompositionPrompt("zaplanuj kampanię");
    expect(p).toMatch(/zaplanuj kampanię/);
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/deps/);
  });
});

describe("goalPlanner — parseGoalPlan", () => {
  it("parsuje kroki z zależnościami (też w ```json)", () => {
    const raw = "```json\n{\"steps\":[{\"id\":\"s1\",\"task\":\"Zbadaj rynek\",\"deps\":[]},{\"id\":\"s2\",\"task\":\"Napisz plan\",\"deps\":[\"s1\"]}]}\n```";
    const plan = parseGoalPlan(raw);
    expect(plan).toHaveLength(2);
    expect(plan[1].deps).toEqual(["s1"]);
  });
  it("odrzuca zależności do nieistniejących id", () => {
    const plan = parseGoalPlan('{"steps":[{"id":"s1","task":"A","deps":["zXY"]}]}');
    expect(plan[0].deps).toEqual([]);
  });
  it("usuwa cykle (zrywa zależności tworzące pętlę)", () => {
    const plan = parseGoalPlan('{"steps":[{"id":"a","task":"A","deps":["b"]},{"id":"b","task":"B","deps":["a"]}]}');
    // po naprawie graf nie ma cyklu
    expect(plan.length).toBe(2);
    // przynajmniej jedna krawędź usunięta → brak realnego cyklu (sprawdzamy, że nie obie zależności istnieją wzajemnie)
    const a = plan.find((s) => s.id === "a")!, b = plan.find((s) => s.id === "b")!;
    expect(!(a.deps.includes("b") && b.deps.includes("a"))).toBe(true);
  });
  it("ogranicza liczbę kroków (cap)", () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, task: `T${i}`, deps: [] }));
    const plan = parseGoalPlan(JSON.stringify({ steps }), 6);
    expect(plan.length).toBeLessThanOrEqual(6);
  });
  it("śmieci / brak JSON → pusta lista", () => {
    expect(parseGoalPlan("nie ma tu planu")).toEqual([]);
    expect(parseGoalPlan("")).toEqual([]);
  });
  it("pomija kroki bez zadania", () => {
    const plan = parseGoalPlan('{"steps":[{"id":"s1","task":"","deps":[]},{"id":"s2","task":"Realne","deps":[]}]}');
    expect(plan).toHaveLength(1);
    expect(plan[0].id).toBe("s2");
  });
});
