import { describe, it, expect } from "vitest";
import { callSignature } from "../src/lib/providers/gemini";

describe("gemini — callSignature (wykrywanie zapętlenia narzędzi)", () => {
  it("ta sama nazwa + te same argumenty → ten sam klucz", () => {
    expect(callSignature("find_leads", { city: "Kraków" })).toBe(callSignature("find_leads", { city: "Kraków" }));
  });

  it("różne argumenty → różny klucz (powtórne wywołanie z innymi danymi jest OK)", () => {
    expect(callSignature("find_leads", { city: "Kraków" })).not.toBe(callSignature("find_leads", { city: "Gdańsk" }));
  });

  it("różne narzędzia → różny klucz", () => {
    expect(callSignature("add_task", {})).not.toBe(callSignature("add_note", {}));
  });

  it("odporne na nieserializowalne argumenty (nie wywala się)", () => {
    const circular: any = {}; circular.self = circular;
    expect(typeof callSignature("x", circular)).toBe("string");
  });
});
