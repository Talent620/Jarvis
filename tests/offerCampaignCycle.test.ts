import { describe, it, expect, vi, beforeEach } from "vitest";

// REGRESJA bezpieczeństwa: runOfferCampaignCycle NIE może wejść dwa razy naraz. Cykl czeka na
// draftOffer+wysyłkę (>90 s bywa realne), a tick odpala się co 90 s — bez blokady re-entrancji
// drugi bieg wysłałby DRUGI mail przed zapisaniem lastSentAt, omijając throttling i dzienny limit.

// Kontrolowana, „wisząca" wysyłka — pierwszy cykl utknie w niej, aż ją zwolnimy.
const h = vi.hoisted(() => {
  let release!: (v: { ok: true; via: "SMTP" }) => void;
  const gate = new Promise<{ ok: true; via: "SMTP" }>((res) => { release = res; });
  const lead = { id: "L1", company: "Firma", email: "a@b.pl", status: "new", offer: "Gotowa oferta", createdAt: 0, updatedAt: 0 };
  return { gate, release: () => release({ ok: true, via: "SMTP" }), sendCalls: { n: 0 }, lead };
});

vi.mock("../src/lib/store", () => ({
  store: {
    settings: {
      emailSignature: "Marcin",
      offerCampaign: {
        active: true, dailyLimit: 20, throttleMs: 90_000, totalCap: 200, sentTotal: 0,
        lastSentAt: 0, startedAt: 0, expiresAt: 9_999_999_999_999, failStreak: 0,
        workingHours: { startHour: 0, endHour: 24, days: [0, 1, 2, 3, 4, 5, 6] },
      },
    },
    data: { leads: [h.lead], sentMail: [] },
    setSettings: vi.fn(),
    setData: vi.fn(),
  },
}));
vi.mock("../src/lib/mailer", () => ({
  canSendDirect: () => true,
  sentTodayCount: () => 0,
  buildSentIndex: () => ({ companies: new Set(), addresses: new Set() }),
  eligibleForBulkSend: () => ({ targets: [h.lead], noEmail: 0, alreadyEmailed: 0, suppressed: 0 }),
  contactSuppressionReason: () => null,
  sendOfferEmail: () => { h.sendCalls.n += 1; return h.gate; }, // pierwsza wysyłka WISI
}));
vi.mock("../src/lib/offer", () => ({ draftOffer: async () => "Gotowa oferta" }));
vi.mock("../src/lib/glinks", () => ({ splitOffer: () => ({ subject: "Temat", body: "Treść" }) }));
vi.mock("../src/lib/permissions", () => ({ grantOutboundScope: vi.fn() }));

import { runOfferCampaignCycle } from "../src/lib/offerCampaign";

describe("runOfferCampaignCycle — bezpiecznik re-entrancji", () => {
  beforeEach(() => { h.sendCalls.n = 0; });

  it("drugi cykl w trakcie pierwszego jest ODRZUCANY (jedna wysyłka na raz)", async () => {
    const first = runOfferCampaignCycle();        // utknie w wiszącej wysyłce
    await Promise.resolve(); await Promise.resolve(); // pozwól pierwszemu dojść do await sendOfferEmail
    const second = await runOfferCampaignCycle(); // MUSI odbić się od blokady, nie wysyłać
    expect(second).toEqual({ sent: false, reason: "cykl już trwa" });
    expect(h.sendCalls.n).toBe(1); // tylko JEDNA realna próba wysyłki, nie dwie

    h.release();                                   // zwolnij pierwszą wysyłkę
    const firstRes = await first;
    expect(firstRes.sent).toBe(true);
  });

  it("po zakończeniu biegu blokada jest zwolniona — kolejny cykl może wejść", async () => {
    // pierwszy bieg już się rozliczył w poprzednim teście (gate zwolniony);
    // nowy cykl nie może utknąć na „cykl już trwa"
    const res = await runOfferCampaignCycle();
    expect(res.reason).not.toBe("cykl już trwa");
  });
});
