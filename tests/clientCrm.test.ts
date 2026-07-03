import { describe, it, expect } from "vitest";
import { clientTimeline, clientCard, nextActionFor, mailMatchesLead, financeMatchesLead, reminderInDays } from "../src/lib/clientCrm";
import type { Lead, SentMail, FinanceProject } from "../src/types";

// Klient 360: składa ISTNIEJĄCE źródła (notatki+maile+finanse). Testy pilnują uczciwego
// dopasowania (cudzy mail NIE trafia do osi czasu klienta) i braku zmyślania pustych pól.

const NOW = new Date(2026, 6, 3, 12, 0, 0).getTime();

function mkLead(over: Partial<Lead> = {}): Lead {
  return {
    id: "L1", company: "Salon Anna", status: "contacted",
    email: "anna@salon.pl", createdAt: NOW - 30 * 86400_000, updatedAt: NOW,
    notes: [{ at: NOW - 5 * 86400_000, text: "Rozmowa — zainteresowana stroną." }],
    ...over,
  } as Lead;
}
const mail = (over: Partial<SentMail> = {}): SentMail =>
  ({ id: "m1", to: "anna@salon.pl", subject: "Oferta strony", company: "Salon Anna", via: "SMTP", at: NOW - 3 * 86400_000, ...over }) as SentMail;
const fin = (over: Partial<FinanceProject> = {}): FinanceProject =>
  ({ id: "f1", name: "Strona WWW", leadId: "L1", status: "w_realizacji", amount: 3500, createdAt: NOW - 2 * 86400_000, updatedAt: NOW, ...over }) as FinanceProject;

describe("dopasowanie źródeł do klienta (uczciwe — bez cudzych danych)", () => {
  it("mail pasuje po firmie (case-insensitive) LUB adresie; cudzy NIE pasuje", () => {
    const lead = mkLead();
    expect(mailMatchesLead(lead, mail({ company: "SALON ANNA", to: "x@x.pl" }))).toBe(true);
    expect(mailMatchesLead(lead, mail({ company: "", to: "ANNA@salon.pl" }))).toBe(true);
    expect(mailMatchesLead(lead, mail({ company: "Inna Firma", to: "kto@inny.pl" }))).toBe(false);
    // pusta firma leada + pusty adres — nic nie pasuje „na siłę"
    expect(mailMatchesLead(mkLead({ company: "", email: "" }), mail({ company: "", to: "" }))).toBe(false);
  });
  it("finanse pasują po leadId (priorytet) albo nazwie klienta; cudze NIE", () => {
    const lead = mkLead();
    expect(financeMatchesLead(lead, fin())).toBe(true);
    expect(financeMatchesLead(lead, fin({ leadId: undefined, client: "salon anna" }))).toBe(true);
    expect(financeMatchesLead(lead, fin({ leadId: "L2", client: "Ktoś Inny" }))).toBe(false);
  });
});

describe("clientTimeline — scalona oś czasu, od najnowszych", () => {
  it("łączy notatki + maile + finanse chronologicznie", () => {
    const t = clientTimeline(mkLead(), [mail()], [fin({ paidAt: NOW - 86400_000, paidAmount: 1500 })]);
    expect(t.map((e) => e.kind)).toEqual(["finance", "finance", "email", "note"]); // płatność najnowsza
    expect(t[0].text).toContain("1500");
    expect(t[2].text).toContain("Oferta strony");
  });
  it("cudze maile/projekty NIE trafiają do osi czasu", () => {
    const t = clientTimeline(mkLead(), [mail({ company: "Obca", to: "obca@x.pl" })], [fin({ leadId: "L9", client: "Obca" })]);
    expect(t).toHaveLength(1); // tylko własna notatka
    expect(t[0].kind).toBe("note");
  });
  it("puste źródła → sama notatka; zero wyjątków przy undefined", () => {
    expect(() => clientTimeline(mkLead(), undefined, undefined)).not.toThrow();
    expect(clientTimeline(mkLead({ notes: [] }), [], [])).toHaveLength(0);
  });
  it("respektuje limit", () => {
    const notes = Array.from({ length: 50 }, (_, i) => ({ at: NOW - i * 1000, text: `n${i}` }));
    expect(clientTimeline(mkLead({ notes }), [], [], 10)).toHaveLength(10);
  });
});

describe("nextActionFor — JEDEN jasny następny krok", () => {
  it("opt-out/doNotContact wygrywają ze wszystkim", () => {
    expect(nextActionFor(mkLead({ optOut: true }), NOW)).toMatch(/opt-out/i);
    expect(nextActionFor(mkLead({ doNotContact: true }), NOW)).toMatch(/nie kontaktować/i);
  });
  it("won → realizacja/płatności; lost → nic do zrobienia", () => {
    expect(nextActionFor(mkLead({ status: "won" }), NOW)).toMatch(/Finanse|realizacj/i);
    expect(nextActionFor(mkLead({ status: "lost" }), NOW)).toMatch(/nic do zrobienia/i);
  });
  it("zaległy follow-up → alarm „dziś”", () => {
    const l = mkLead({ nextFollowUpAt: NOW - 86400_000, lastContactedAt: NOW - 10 * 86400_000 });
    expect(nextActionFor(l, NOW)).toMatch(/ZALEGŁY/);
  });
  it("nowy → pierwszy kontakt; oferta → zaplanuj follow-up", () => {
    expect(nextActionFor(mkLead({ status: "new", notes: [] }), NOW)).toMatch(/Pierwszy kontakt/i);
    expect(nextActionFor(mkLead({ status: "offer" }), NOW)).toMatch(/follow-up/i);
  });
});

describe("clientCard — podsumowanie bez zmyślania", () => {
  it("liczy maile/finanse tylko własne; wartość undefined gdy brak (nie 0)", () => {
    const c = clientCard(mkLead(), [mail(), mail({ id: "m2", company: "Obca", to: "o@o.pl" })], [fin({ paidAmount: 1500, paidAt: NOW })], NOW);
    expect(c.emailCount).toBe(1);
    expect(c.financeCount).toBe(1);
    expect(c.financeTotal).toBe(3500);
    expect(c.financePaid).toBe(1500);
    expect(c.value).toBeUndefined(); // nie wpisano wartości → uczciwe „brak", nie zero
  });
  it("ostatni ślad = najświeższe z maila/notatki/kontaktu, z etykietą CO to było", () => {
    const c = clientCard(mkLead(), [mail({ at: NOW - 1000 })], [], NOW);
    expect(c.lastTouchAt).toBe(NOW - 1000);
    expect(c.lastTouchWhat).toBe("e-mail");
    const c2 = clientCard(mkLead({ lastContactedAt: NOW - 500 }), [mail({ at: NOW - 1000 })], [], NOW);
    expect(c2.lastTouchWhat).toBe("kontakt");
  });
  it("świeży lead bez historii → puste pola, żadnych wymyślonych dat", () => {
    const c = clientCard(mkLead({ notes: [], lastContactedAt: undefined }), [], [], NOW);
    expect(c.lastTouchAt).toBeUndefined();
    expect(c.emailCount).toBe(0);
  });
});

describe("reminderInDays — przewidywalny termin przypomnienia", () => {
  it("za N dni o 9:00 lokalnie (nie w środku nocy), minimum 1 dzień", () => {
    const at = reminderInDays(2, NOW);
    const d = new Date(at);
    expect(d.getHours()).toBe(9);
    expect(at).toBeGreaterThan(NOW);
    expect(new Date(reminderInDays(0, NOW)).getTime()).toBeGreaterThan(NOW); // 0 → min. jutro
  });
});
