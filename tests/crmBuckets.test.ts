// === Kubełki CRM (crmBuckets) — testy ===
// Domyślny widok „Do działania" nie pokazuje odrzuconych; odrzuceni (lost) → Archiwum; klienci (won) → Klienci.
import { describe, it, expect } from "vitest";
import { leadBucket, bucketCounts, leadsInBucket } from "../src/lib/crmBuckets";
import type { Lead } from "../src/types";

const lead = (status: Lead["status"]): Lead => ({ id: status, company: status, status, createdAt: 1, updatedAt: 1 });

describe("crmBuckets — klasyfikacja", () => {
  it("new/contacted/offer → Do działania; won → Klienci; lost → Archiwum", () => {
    expect(leadBucket(lead("new"))).toBe("actionable");
    expect(leadBucket(lead("contacted"))).toBe("actionable");
    expect(leadBucket(lead("offer"))).toBe("actionable");
    expect(leadBucket(lead("won"))).toBe("clients");
    expect(leadBucket(lead("lost"))).toBe("archive");
  });

  it("Do działania NIE zawiera odrzuconych", () => {
    const leads = [lead("new"), lead("lost"), lead("won"), lead("offer")];
    const actionable = leadsInBucket(leads, "actionable");
    expect(actionable.map((l) => l.status)).toEqual(["new", "offer"]);
    expect(actionable.some((l) => l.status === "lost")).toBe(false);
  });

  it("liczniki zgadzają się z podziałem", () => {
    const leads = [lead("new"), lead("contacted"), lead("won"), lead("lost"), lead("lost")];
    expect(bucketCounts(leads)).toEqual({ actionable: 2, clients: 1, archive: 2 });
  });
});
