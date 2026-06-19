import { describe, it, expect } from "vitest";
import { conversationStyleDirectives } from "../src/lib/conversationStyle";

describe("conversationStyle — neutralne domyślne = bez zmian", () => {
  it("balanced + 0.5 → brak dyrektyw (zachowanie bez zmian)", () => {
    expect(conversationStyleDirectives({ responseLength: "balanced", warmth: 0.5 })).toEqual([]);
  });
});

describe("conversationStyle — długość", () => {
  it("concise → dyrektywa zwięzłości", () => {
    const d = conversationStyleDirectives({ responseLength: "concise", warmth: 0.5 });
    expect(d.join(" ")).toMatch(/zwięźle|1–3 zdania/);
  });
  it("detailed → dyrektywa rozwinięcia", () => {
    expect(conversationStyleDirectives({ responseLength: "detailed", warmth: 0.5 }).join(" ")).toMatch(/wyczerpująco|przykłady/);
  });
});

describe("conversationStyle — ciepło", () => {
  it("wysokie (>=0.7) → cieplej i po ludzku", () => {
    expect(conversationStyleDirectives({ responseLength: "balanced", warmth: 0.8 }).join(" ")).toMatch(/cieplej|empati/i);
  });
  it("niskie (<=0.3) → rzeczowo i formalnie", () => {
    expect(conversationStyleDirectives({ responseLength: "balanced", warmth: 0.2 }).join(" ")).toMatch(/formalnie|rzeczowo/);
  });
  it("łączy długość i ciepło", () => {
    const d = conversationStyleDirectives({ responseLength: "concise", warmth: 0.9 });
    expect(d.length).toBe(2);
  });
});
