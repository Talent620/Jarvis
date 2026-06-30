import { describe, it, expect } from "vitest";
import { recommendBrain, activeBrainLabel, FREE_RANK } from "../src/lib/brainAdvisor";
import type { ProviderId } from "../src/lib/providers/types";

const keys = (...have: ProviderId[]) => (id: ProviderId) => have.includes(id);
const labelOf = (id: string) => ({ gemini: "Gemini", groq: "Groq", anthropic: "Claude" } as Record<string, string>)[id] || id;

describe("brainAdvisor — activeBrainLabel (co NAPRAWDĘ działa)", () => {
  it("wybrany dostawca z kluczem → pokazuje jego nazwę i model", () => {
    expect(activeBrainLabel("gemini", "gemini-2.5-flash", keys("gemini"), labelOf)).toBe("Gemini · gemini-2.5-flash");
  });

  it("wybrany BEZ klucza, ale inny ma → pokazuje zapas z dopiskiem", () => {
    const out = activeBrainLabel("gemini", "gemini-2.5-flash", keys("groq"), labelOf);
    expect(out).toMatch(/zapasowo/);
    expect(out).toMatch(/Groq/);
    expect(out).toMatch(/Gemini/); // wyjaśnia, że brak klucza dla Gemini
  });

  it("brak jakichkolwiek kluczy → komunikat o dodaniu klucza", () => {
    expect(activeBrainLabel("gemini", "gemini-2.5-flash", keys(), labelOf)).toMatch(/dodaj klucz/i);
  });

  it("auto z kluczem → opis auto; bez klucza → prośba o klucz", () => {
    expect(activeBrainLabel("auto", "auto", keys("gemini"), labelOf)).toMatch(/Auto/);
    expect(activeBrainLabel("auto", "auto", keys(), labelOf)).toMatch(/brak klucza/i);
  });
});

describe("brainAdvisor — recommendBrain (który API najlepszy)", () => {
  it("brak kluczy → poradź dodać DARMOWY Gemini", () => {
    const a = recommendBrain(keys(), "gemini", "gemini-2.5-flash");
    expect(a.action).toBe("add_key");
    expect(a.provider).toBeNull();
    expect(a.message).toMatch(/aistudio\.google\.com|DARMOWY/);
  });

  it("ma Gemini i jest przypięty → OK, nic nie zmieniać", () => {
    const a = recommendBrain(keys("gemini"), "gemini", "gemini-2.5-flash");
    expect(a.action).toBe("ok");
    expect(a.provider).toBe("gemini");
  });

  it("ma Gemini ale tryb auto → zaproponuj przypięcie", () => {
    const a = recommendBrain(keys("gemini"), "auto", "auto");
    expect(a.action).toBe("pin");
    expect(a.provider).toBe("gemini");
    expect(a.message).toMatch(/stały umysł/i);
  });

  it("ma Gemini ale ustawiony inny dostawca → zaproponuj przełączenie na Gemini", () => {
    const a = recommendBrain(keys("gemini", "groq"), "groq", "meta-llama/llama-4-scout-17b-16e-instruct");
    expect(a.action).toBe("switch");
    expect(a.provider).toBe("gemini");
  });

  it("ma tylko Groq (bez Gemini) → OK na Groq, ale podpowiedz dodać Gemini", () => {
    const a = recommendBrain(keys("groq"), "groq", "meta-llama/llama-4-scout-17b-16e-instruct");
    expect(a.provider).toBe("groq");
    expect(a.message).toMatch(/Gemini/);
  });

  it("Gemini ma najwyższy priorytet w rankingu darmowych", () => {
    expect(FREE_RANK[0].id).toBe("gemini");
  });
});

describe("suggest_ai — narzędzie czatu", () => {
  it("zarejestrowane i sklasyfikowane jako read", async () => {
    const { toolDefs } = await import("../src/lib/tools");
    const { riskOf } = await import("../src/lib/permissions");
    expect(toolDefs.some((d) => d.name === "suggest_ai")).toBe(true);
    expect(riskOf("suggest_ai")).toBe("read");
  });
});
