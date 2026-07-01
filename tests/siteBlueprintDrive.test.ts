// === Blueprint realnie STERUJE generowaniem (siteBlueprintDrive) — testy ===
// DoD: zmiana blueprintu powoduje MIERZALNĄ zmianę wejścia generatora (a nie ozdobę UI).
// Mockujemy model (askModel) — zero prawdziwego API — i sprawdzamy, co trafia do generatora.
import { describe, it, expect, vi } from "vitest";

// Mock modelu: przechwytujemy prompt przekazany do askModel; zwracamy poprawny HTML.
// vi.hoisted — spy musi istnieć zanim zahoistowany vi.mock go użyje.
const { askModelSpy } = vi.hoisted(() => ({
  askModelSpy: vi.fn(async () => "<!DOCTYPE html><html><head><title>x</title></head><body><h1>x</h1></body></html>"),
}));
vi.mock("../src/lib/brain", async (orig) => ({ ...(await orig() as object), askModel: askModelSpy }));

import { generateSite, planBlueprint } from "../src/lib/webgen";
import { blueprintToInstruction, fallbackBlueprint, validateBlueprint, type SiteBlueprint } from "../src/lib/siteBlueprint";

const bpA = validateBlueprint({ businessGoal: "sprzedaż kursu", primaryAction: "Kup teraz", motionLevel: "none", preloader: false,
  sections: [{ kind: "hero", justification: "uwaga" }, { kind: "offer", justification: "wartość" }, { kind: "cta", justification: "domknięcie" }] }, {});
const bpB = validateBlueprint({ businessGoal: "rezerwacje stolika", primaryAction: "Zarezerwuj", motionLevel: "rich", preloader: true,
  sections: [{ kind: "hero", justification: "uwaga" }, { kind: "gallery", justification: "apetyt" }, { kind: "proof", justification: "opinie" }, { kind: "cta", justification: "rezerwacja" }] }, {});

describe("blueprintToInstruction — różne plany → różne instrukcje", () => {
  it("inny CTA/sekcje/ruch/preloader → mierzalnie inny tekst", () => {
    const a = blueprintToInstruction(bpA);
    const b = blueprintToInstruction(bpB);
    expect(a).not.toBe(b);
    expect(a).toMatch(/Kup teraz/);
    expect(b).toMatch(/Zarezerwuj/);
    expect(a).toMatch(/Preloader: NIE/);
    expect(b).toMatch(/Preloader: TAK/);
    expect(a).toMatch(/bez animacji/);
    expect(b).toMatch(/wyrazisty ruch/);
    expect(b).toMatch(/gallery/); // sekcja tylko w B
  });
});

describe("generateSite — blueprint trafia do promptu generatora", () => {
  it("różny blueprint → różny prompt modelu (ta sama treść wejścia zmienia się z planem)", async () => {
    askModelSpy.mockClear();
    await generateSite("zbuduj stronę", undefined, "auto", "auto", bpA);
    const promptA = askModelSpy.mock.calls[0][0].history[0].content as string;
    askModelSpy.mockClear();
    await generateSite("zbuduj stronę", undefined, "auto", "auto", bpB);
    const promptB = askModelSpy.mock.calls[0][0].history[0].content as string;

    expect(promptA).toMatch(/Kup teraz/);        // CTA z blueprintu w prompcie
    expect(promptB).toMatch(/Zarezerwuj/);
    expect(promptA).not.toBe(promptB);           // zmiana planu = zmiana wejścia generatora
  });

  it("bez blueprintu prompt NIE zawiera bloku planu (kompatybilność wstecz)", async () => {
    askModelSpy.mockClear();
    await generateSite("zbuduj stronę", undefined, "auto", "auto");
    const p = askModelSpy.mock.calls[0][0].history[0].content as string;
    expect(p).not.toMatch(/PLAN STRONY \(ZATWIERDZONY/);
  });
});

describe("planBlueprint — structured output + fallback offline", () => {
  it("poprawny JSON z modelu → source ai, użyty CTA", async () => {
    const ask = async () => JSON.stringify({ businessGoal: "x", primaryAction: "Zamów teraz", sections: [{ kind: "hero", justification: "uwaga" }] });
    const r = await planBlueprint({ business: "Alfa" }, ask);
    expect(r.source).toBe("ai");
    expect(r.blueprint.primaryAction).toBe("Zamów teraz");
  });

  it("błąd/brak sieci modelu → deterministyczny fallback", async () => {
    const ask = async () => { throw new Error("offline"); };
    const r = await planBlueprint({ business: "Alfa" }, ask);
    expect(r.source).toBe("fallback");
    expect(r.blueprint.primaryAction).toBeTruthy();
    expect(r.blueprint).toEqual(fallbackBlueprint({ business: "Alfa" }) as SiteBlueprint);
  });
});
