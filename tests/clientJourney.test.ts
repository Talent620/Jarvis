// === Ścieżka klienta (clientJourney) — testy ===
// Adapter nad businessFlow: etap lejka (Kandydat→Do kontaktu→Oferta→Klient→Archiwum) + jedno „Co dalej".
import { describe, it, expect } from "vitest";
import { clientJourney, pipelineStageOf, pipelineCounts, PIPELINE_LABEL } from "../src/lib/clientJourney";
import type { Lead, FinanceProject, SentMail } from "../src/types";

const NOW = 1_000_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "Alfa", status: "new", createdAt: NOW, updatedAt: NOW, ...over });
const noProjects: FinanceProject[] = [];
const noSent: SentMail[] = [];

describe("clientJourney — etap lejka", () => {
  it("nowy lead bez teczki → Kandydat", () => {
    expect(clientJourney(lead({}), noProjects, noSent).stage).toBe("candidate");
  });
  it("lead z ofertą → Oferta; wygrany → Klient; odrzucony → Archiwum", () => {
    expect(clientJourney(lead({ offer: "oferta..." }), noProjects, noSent).stage).toBe("offer");
    expect(clientJourney(lead({ status: "won" }), noProjects, noSent).stage).toBe("client");
    expect(clientJourney(lead({ status: "lost" }), noProjects, noSent).stage).toBe("archive");
  });
  it("opłacony projekt → Klient (domknięte)", () => {
    const projects: FinanceProject[] = [{ id: "p", client: "Alfa", status: "oplacone" } as FinanceProject];
    const v = clientJourney(lead({}), projects, noSent);
    expect(v.stage).toBe("client");
    expect(v.done).toBe(true);
    expect(v.progressPct).toBe(100);
  });
});

describe("clientJourney — jedno „Co dalej”", () => {
  it("zwraca konkretny następny krok i ekran", () => {
    const v = clientJourney(lead({}), noProjects, noSent);
    expect(v.nextReason.length).toBeGreaterThan(0);
    expect(typeof v.screen).toBe("string");
    expect(v.stageLabel).toBe(PIPELINE_LABEL.candidate);
  });
});

describe("clientJourney — liczniki lejka", () => {
  it("pipelineCounts rozkłada leady po etapach", () => {
    const leads = [lead({ id: "a" }), lead({ id: "b", status: "won" }), lead({ id: "c", status: "lost" }), lead({ id: "d", offer: "x" })];
    const c = pipelineCounts(leads, noProjects, noSent);
    expect(c.candidate).toBe(1);
    expect(c.client).toBe(1);
    expect(c.archive).toBe(1);
    expect(c.offer).toBe(1);
  });
  it("pipelineStageOf jest czyste i deterministyczne", () => {
    expect(pipelineStageOf({ status: "lost" }, "offer_ready")).toBe("archive"); // status lost wygrywa
  });
});
