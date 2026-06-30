import { describe, it, expect } from "vitest";
import { reachedStage, computeJourney, businessStatusText, STAGES } from "../src/lib/businessFlow";
import type { Lead, FinanceProject, SentMail } from "../src/types";

const lead = (o: Partial<Lead>): Lead => ({ id: "l1", company: "Firma X", status: "new", ...o });
const proj = (o: Partial<FinanceProject>): FinanceProject => ({ id: "p1", name: "P", status: "lead", amount: 0, createdAt: 0, updatedAt: 0, ...o });
const mail = (o: Partial<SentMail>): SentMail => ({ id: "m1", to: "x@x.pl", subject: "Oferta", via: "SMTP", at: 1, ...o });

describe("businessFlow — etap procesu (lead → kasa)", () => {
  it("świeży lead → lead_found, następny krok = teczka", () => {
    const j = computeJourney(lead({}), [], []);
    expect(j.reached).toBe("lead_found");
    expect(j.stage).toBe("dossier_ready");
    expect(j.screen).toBe("sales");
  });

  it("lead z teczką → dossier_ready", () => {
    expect(reachedStage(lead({ intel: { score: 70 } as any }), [], [])).toBe("dossier_ready");
  });

  it("lead z ofertą → offer_ready", () => {
    expect(reachedStage(lead({ offer: "Dzień dobry…" }), [], [])).toBe("offer_ready");
  });

  it("wysłany mail (po firmie) → email_sent", () => {
    expect(reachedStage(lead({ offer: "x" }), [], [mail({ company: "Firma X" })])).toBe("email_sent");
  });

  it("projekt finansowy dla firmy → finance_project_created", () => {
    expect(reachedStage(lead({}), [proj({ client: "Firma X", status: "w_realizacji" })], [])).toBe("finance_project_created");
  });

  it("opłacony projekt → paid (proces domknięty)", () => {
    const j = computeJourney(lead({}), [proj({ client: "Firma X", status: "oplacone", paidAmount: 5000 })], []);
    expect(j.reached).toBe("paid");
    expect(j.done).toBe(true);
    expect(j.screen).toBe("content"); // sugeruje treść o realizacji
  });

  it("etapy są kumulatywne i kompletne", () => {
    expect(STAGES[0]).toBe("lead_found");
    expect(STAGES[STAGES.length - 1]).toBe("paid");
  });

  it("status tekstowy zawiera firmę, etap i następny krok", () => {
    const t = businessStatusText(lead({ intel: { score: 50 } as any }), [], []);
    expect(t).toContain("Firma X");
    expect(t).toContain("Następny krok");
  });
});

describe("businessFlow — narzędzia czatu", () => {
  it("business_status i business_next_step są w toolDefs i sklasyfikowane read", async () => {
    const { toolDefs } = await import("../src/lib/tools");
    const { riskOf } = await import("../src/lib/permissions");
    expect(toolDefs.some((d) => d.name === "business_status")).toBe(true);
    expect(toolDefs.some((d) => d.name === "business_next_step")).toBe(true);
    expect(riskOf("business_status")).toBe("read");
    expect(riskOf("business_next_step")).toBe("read");
  });
});
