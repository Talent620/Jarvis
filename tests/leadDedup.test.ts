// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { normName, normPhone, normEmail, leadKeys, saveLeads, type RawLead } from "../src/lib/leads";
import { store } from "../src/lib/store";

beforeEach(() => store.setData((d) => { d.leads = []; }));

describe("leads — normalizacja kluczy dedupu", () => {
  it("normName: lowercase + zwija spacje", () => {
    expect(normName("  Pizza   Roma ")).toBe("pizza roma");
  });
  it("normPhone: ostatnie 9 cyfr, ignoruje prefiks i formatowanie", () => {
    expect(normPhone("+48 600 700 800")).toBe("600700800");
    expect(normPhone("600-700-800")).toBe("600700800");
    expect(normPhone("123")).toBe(""); // za krótki
  });
  it("normEmail: lowercase + wymaga @", () => {
    expect(normEmail(" Biuro@Firma.PL ")).toBe("biuro@firma.pl");
    expect(normEmail("600700800")).toBe("");
  });
});

describe("leads — leadKeys", () => {
  it("buduje klucze nazwa/telefon/email", () => {
    expect(leadKeys({ company: "Roma", phone: "+48600700800", email: "a@b.pl" })).toEqual(["n:roma", "p:600700800", "e:a@b.pl"]);
  });
  it("contact będący e-mailem nie jest traktowany jako telefon", () => {
    expect(leadKeys({ company: "X", contact: "kontakt@x.pl" })).toEqual(["n:x", "e:kontakt@x.pl"]);
  });
  it("contact będący telefonem trafia do klucza telefonu", () => {
    expect(leadKeys({ company: "X", contact: "600 700 800" })).toEqual(["n:x", "p:600700800"]);
  });
});

const raw = (p: Partial<RawLead>): RawLead => ({ company: "Firma", hasWebsite: false, ...p });

describe("leads — saveLeads dedup (nazwa + telefon + email)", () => {
  it("dodaje nowe leady", () => {
    const added = saveLeads([raw({ company: "Alfa" }), raw({ company: "Beta" })], "x", "Kraków");
    expect(added).toHaveLength(2);
    expect(store.data.leads).toHaveLength(2);
  });

  it("pomija duplikat po nazwie (case-insensitive)", () => {
    saveLeads([raw({ company: "Alfa" })], "x", "Kraków");
    const added = saveLeads([raw({ company: "ALFA" })], "x", "Kraków");
    expect(added).toHaveLength(0);
    expect(store.data.leads).toHaveLength(1);
  });

  it("pomija duplikat po TELEFONIE mimo innej nazwy", () => {
    saveLeads([raw({ company: "Pizza Roma", phone: "+48 600 700 800" })], "x", "Kraków");
    const added = saveLeads([raw({ company: "Pizzeria Roma", phone: "600-700-800" })], "x", "Kraków");
    expect(added).toHaveLength(0);
    expect(store.data.leads).toHaveLength(1);
  });

  it("pomija duplikat po E-MAILU mimo innej nazwy", () => {
    saveLeads([raw({ company: "Salon A", email: "Kontakt@Salon.pl" })], "x", "Kraków");
    const added = saveLeads([raw({ company: "Salon B", email: "kontakt@salon.pl" })], "x", "Kraków");
    expect(added).toHaveLength(0);
  });

  it("deduplikuje WEWNĄTRZ jednej partii po telefonie", () => {
    const added = saveLeads(
      [raw({ company: "Jeden", phone: "600700800" }), raw({ company: "Dwa", phone: "+48 600 700 800" })],
      "x",
      "Kraków",
    );
    expect(added).toHaveLength(1);
    expect(store.data.leads).toHaveLength(1);
  });

  it("różne firmy bez wspólnych kluczy → obie dodane", () => {
    const added = saveLeads(
      [raw({ company: "Alfa", phone: "600000001" }), raw({ company: "Beta", phone: "600000002" })],
      "x",
      "Kraków",
    );
    expect(added).toHaveLength(2);
  });
});
