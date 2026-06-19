// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { isOpenNow, openLabel, callNowList, followUpsDue, followUpMessage, markContacted, scheduleFollowUp, snoozeFollowUp, followUpDueAt, pipelineForecast, leadsToCsv, searchLeads, wasLeadEmailed } from "../src/lib/salesEngine";
import type { SentMail } from "../src/types";
import { rankRawLeads } from "../src/lib/leads";
import { store, uid } from "../src/lib/store";
import type { Lead, LeadStatus } from "../src/types";

// Poniedziałek 2026-06-15, 10:00 — stały punkt odniesienia.
const MON_10 = new Date("2026-06-15T10:00:00");
const MON_20 = new Date("2026-06-15T20:00:00");
const SUN_10 = new Date("2026-06-14T10:00:00"); // niedziela

function lead(p: Partial<Lead>): Lead {
  return { id: uid(), company: "Firma", status: "new", createdAt: 0, updatedAt: 0, ...p };
}

describe("searchLeads — wyszukiwarka leadów", () => {
  const data: Lead[] = [
    lead({ company: "Salon Ola", location: "Kraków", contact: "ola@x.pl", niche: "fryzjer" }),
    lead({ company: "Warsztat Marek", location: "Wrocław", note: "pilny klient" }),
    lead({ company: "Piekarnia Nowak", contact: "600100200" }),
  ];

  it("pusty tekst → cała lista", () => {
    expect(searchLeads(data, "")).toHaveLength(3);
    expect(searchLeads(data, "   ")).toHaveLength(3);
  });

  it("szuka po nazwie firmy (bez względu na wielkość liter)", () => {
    expect(searchLeads(data, "salon").map((l) => l.company)).toEqual(["Salon Ola"]);
    expect(searchLeads(data, "NOWAK")).toHaveLength(1);
  });

  it("szuka po mieście, kontakcie, niszy i notatce", () => {
    expect(searchLeads(data, "wrocław")).toHaveLength(1);
    expect(searchLeads(data, "600100200")).toHaveLength(1);
    expect(searchLeads(data, "fryzjer")).toHaveLength(1);
    expect(searchLeads(data, "pilny")).toHaveLength(1);
  });

  it("brak dopasowania → pusto", () => {
    expect(searchLeads(data, "xyz")).toHaveLength(0);
  });
});

describe("wasLeadEmailed — znacznik wysłanej oferty", () => {
  const sent: SentMail[] = [
    { id: "1", to: "ola@x.pl", subject: "Oferta", company: "Salon Ola", via: "SMTP", at: 0 },
  ];
  it("dopasowuje po nazwie firmy", () => {
    expect(wasLeadEmailed(lead({ company: "Salon Ola" }), sent)).toBe(true);
    expect(wasLeadEmailed(lead({ company: "Inna Firma" }), sent)).toBe(false);
  });
  it("dopasowuje po adresie e-mail w kontakcie", () => {
    expect(wasLeadEmailed(lead({ company: "X", contact: "ola@x.pl" }), sent)).toBe(true);
    expect(wasLeadEmailed(lead({ company: "X", contact: "600100200" }), sent)).toBe(false);
  });
  it("dopasowuje po adresie w dedykowanym polu email (regresja: adres bywa w `email`, nie `contact`)", () => {
    expect(wasLeadEmailed(lead({ company: "X", email: "ola@x.pl", contact: "600100200" }), sent)).toBe(true);
  });
  it("pusta skrzynka → false", () => {
    expect(wasLeadEmailed(lead({ company: "Salon Ola" }), [])).toBe(false);
  });
});

describe("godziny otwarcia (opening_hours)", () => {
  it("Mo-Fr 09:00-18:00: otwarte w pon 10:00, zamknięte w pon 20:00 i w niedzielę", () => {
    expect(isOpenNow("Mo-Fr 09:00-18:00", MON_10)).toBe(true);
    expect(isOpenNow("Mo-Fr 09:00-18:00", MON_20)).toBe(false);
    expect(isOpenNow("Mo-Fr 09:00-18:00", SUN_10)).toBe(false);
  });
  it("24/7 zawsze otwarte; brak danych → null", () => {
    expect(isOpenNow("24/7", MON_20)).toBe(true);
    expect(isOpenNow(undefined, MON_10)).toBeNull();
    expect(isOpenNow("coś dziwnego", MON_10)).toBeNull();
  });
  it("kilka reguł i przerwa obiadowa", () => {
    expect(isOpenNow("Mo-Fr 09:00-13:00,14:00-18:00", new Date("2026-06-15T13:30:00"))).toBe(false);
    expect(isOpenNow("Mo-Fr 09:00-13:00,14:00-18:00", new Date("2026-06-15T15:00:00"))).toBe(true);
  });
  it("Mo-Sa 08:00-20:00; Su off", () => {
    expect(isOpenNow("Mo-Sa 08:00-20:00; Su off", new Date("2026-06-13T12:00:00"))).toBe(true); // sobota
    expect(isOpenNow("Mo-Sa 08:00-20:00; Su off", SUN_10)).toBe(false);
  });
  it("openLabel daje czytelny status", () => {
    expect(openLabel("Mo-Fr 09:00-18:00", MON_10).open).toBe(true);
    expect(openLabel(undefined, MON_10).text).toMatch(/nieznane/);
  });
});

describe("lista Dzwoń teraz", () => {
  beforeEach(() => store.setData((d) => { d.leads = []; }));
  it("bierze tylko nowe z telefonem i otwarte; gorętsze i potwierdzone-otwarte wyżej", () => {
    store.setData((d) => {
      d.leads = [
        lead({ company: "Zamknięta", contact: "111", hours: "Mo-Fr 09:00-18:00", status: "new" }),     // o 20:00 zamknięta → odpada
        lead({ company: "Otwarta-zimna", contact: "222", hours: "24/7", status: "new", intel: { score: 40, updatedAt: 0 } }),
        lead({ company: "Otwarta-gorąca", contact: "333", hours: "24/7", status: "new", intel: { score: 90, updatedAt: 0 } }),
        lead({ company: "Bez telefonu", contact: "x@y.pl", hours: "24/7", status: "new" }),              // brak telefonu → odpada
        lead({ company: "Zaczepiona", contact: "444", hours: "24/7", status: "contacted" }),             // nie „new" → odpada
      ];
    });
    const list = callNowList(store.data.leads, MON_20);
    expect(list.map((l) => l.company)).toEqual(["Otwarta-gorąca", "Otwarta-zimna"]);
  });
});

describe("silnik follow-upów", () => {
  beforeEach(() => store.setData((d) => { d.leads = []; }));
  const now = Date.UTC(2026, 5, 15, 10, 0, 0);
  const days = (n: number) => now - n * 86400000;

  it("due: zaczepiony >3 dni temu, bez odpowiedzi, nie za często", () => {
    store.setData((d) => {
      d.leads = [
        lead({ company: "Świeży", status: "contacted", lastContactedAt: days(1) }),     // za wcześnie
        lead({ company: "Gotowy", status: "contacted", lastContactedAt: days(5) }),      // due
        lead({ company: "Oferta", status: "offer", lastContactedAt: days(4) }),          // due
        lead({ company: "Wygrany", status: "won", lastContactedAt: days(9) }),           // nie ścigamy
        lead({ company: "Wyczerpany", status: "contacted", lastContactedAt: days(9), followUpCount: 4 }), // limit
      ];
    });
    const due = followUpsDue(store.data.leads, now);
    expect(due.map((l) => l.company).sort()).toEqual(["Gotowy", "Oferta"]);
  });

  it("treść follow-upu eskaluje delikatnie i nie jest pusta", () => {
    const l = lead({ company: "Salon Ola" });
    expect(followUpMessage(l, 1)).toMatch(/Salon Ola/);
    expect(followUpMessage(l, 3)).toMatch(/ostatnia wiadomość/i);
  });

  it("markContacted ustawia kontakt, status i licznik follow-upów", () => {
    store.setData((d) => { d.leads = [lead({ id: "L1", status: "new" })]; });
    markContacted("L1");
    let l = store.data.leads[0];
    expect(l.status).toBe("contacted");
    expect(l.lastContactedAt).toBeGreaterThan(0);
    markContacted("L1", true);
    l = store.data.leads[0];
    expect(l.followUpCount).toBe(1);
  });

  it("markContacted AUTOMATYCZNIE planuje następny follow-up (kadencja z ustawień)", () => {
    store.setSettings({ followUpDays: 5 });
    store.setData((d) => { d.leads = [lead({ id: "L1", status: "new" })]; });
    const before = Date.now();
    markContacted("L1");
    const l = store.data.leads[0];
    expect(l.nextFollowUpAt).toBeGreaterThanOrEqual(before + 5 * 86400000 - 1000);
    store.setSettings({ followUpDays: 3 }); // przywróć domyślną kadencję
  });

  it("nextFollowUpAt ma pierwszeństwo nad regułą co-N-dni", () => {
    const now = Date.UTC(2026, 5, 15, 10, 0, 0);
    store.setData((d) => {
      d.leads = [
        lead({ id: "S", company: "Zaplanowany na jutro", status: "contacted", lastContactedAt: now - 9 * 86400000, nextFollowUpAt: now + 86400000 }), // mimo starego kontaktu — jeszcze nie czas
        lead({ id: "D", company: "Zaplanowany na wczoraj", status: "offer", lastContactedAt: now, nextFollowUpAt: now - 86400000 }), // termin minął → due
      ];
    });
    const due = followUpsDue(store.data.leads, now);
    expect(due.map((l) => l.company)).toEqual(["Zaplanowany na wczoraj"]);
  });

  it("scheduleFollowUp i snoozeFollowUp ustawiają termin", () => {
    store.setData((d) => { d.leads = [lead({ id: "L1", status: "contacted" })]; });
    scheduleFollowUp("L1", 123456);
    expect(store.data.leads[0].nextFollowUpAt).toBe(123456);
    snoozeFollowUp("L1", 2, 1000);
    expect(store.data.leads[0].nextFollowUpAt).toBe(1000 + 2 * 86400000);
  });

  it("followUpDueAt: zaplanowany termin albo kontakt + N dni", () => {
    expect(followUpDueAt(lead({ nextFollowUpAt: 999 }), 3)).toBe(999);
    expect(followUpDueAt(lead({ lastContactedAt: 0 }), 3)).toBe(3 * 86400000);
  });
});

describe("prognoza lejka i eksport CSV", () => {
  const leads: Lead[] = [
    lead({ status: "new", value: 1000 }),
    lead({ status: "offer", value: 2000 }),
    lead({ status: "won", value: 3000 }),
    lead({ status: "lost", value: 5000 }),
  ];
  it("forecast: ważona wartość, lejek i zarobione liczone poprawnie", () => {
    const f = pipelineForecast(leads);
    expect(f.won).toBe(3000);
    expect(f.pipeline).toBe(3000);                       // new+offer (lost i won poza lejkiem)
    expect(f.expected).toBe(Math.round(1000 * 0.05 + 2000 * 0.4)); // 850
    expect(f.counts.won).toBe(1);
  });
  it("CSV: nagłówek + wiersze, polskie znaki i przecinki w cudzysłowach", () => {
    const csv = leadsToCsv([lead({ company: "Bar, Pub „X”", contact: "600100200", status: "new" as LeadStatus })]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("Firma");
    expect(lines[1]).toMatch(/^"Bar, Pub/); // przecinek → pole w cudzysłowach
  });
});

describe("niezawodność rankingu leadów", () => {
  it("rankRawLeads: bez strony+telefon na górze, dedup po nazwie", () => {
    const els = [
      { tags: { name: "Ze stroną", website: "https://x.pl", phone: "1" } },
      { tags: { name: "Bez strony z tel", phone: "2" } },
      { tags: { name: "bez strony z tel" } }, // duplikat (case-insensitive) → odpada
      { tags: { name: "Bez nazwy ale", shop: "x" } },
    ];
    const r = rankRawLeads(els, 10, false);
    expect(r[0].company).toBe("Bez strony z tel");
    expect(r.filter((l) => l.company.toLowerCase() === "bez strony z tel")).toHaveLength(1);
  });
});
