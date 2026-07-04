// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { findLeads } from "../src/lib/leads";
import { buildDossier, smsDraft } from "../src/lib/leadIntel";
import { store } from "../src/lib/store";

// PEŁNY test rurociągu leadów na realistycznych odpowiedziach API (dokładny
// format Nominatim i Overpass): szukanie → zapis z e-mailem/adresem/godzinami →
// teczka (audyt strony + scoring) → szkic SMS. Sieć zamockowana 1:1 z realnym
// kształtem odpowiedzi, więc test sprawdza całą NASZĄ logikę end-to-end.

const NOMINATIM_RESP = [{ display_name: "Kraków, województwo małopolskie, Polska", boundingbox: ["49.97", "50.13", "19.79", "20.22"] }];

const OVERPASS_RESP = {
  elements: [
    {
      type: "node", id: 1,
      tags: {
        name: "Salon Fryzjerski Ola", shop: "hairdresser",
        "contact:phone": "+48 600 100 200", "contact:email": "salon@ola.pl",
        "addr:street": "Floriańska", "addr:housenumber": "12", "addr:city": "Kraków",
        opening_hours: "Mo-Fr 09:00-18:00",
      },
    },
    {
      type: "way", id: 2,
      tags: { name: "Barber Brothers", shop: "hairdresser", phone: "+48 501 502 503", website: "https://barberbrothers.pl" },
    },
    { type: "node", id: 3, tags: { shop: "hairdresser" } }, // bez nazwy → odrzucony
  ],
};

const WEAK_SITE_HTML = "<html><head><title>BB</title></head><body>Strona w budowie</body></html>";

beforeEach(() => {
  store.setData((d) => { d.leads = []; });
  vi.stubGlobal("fetch", vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("nominatim")) return new Response(JSON.stringify(NOMINATIM_RESP));
    if (u.includes("overpass")) return new Response(JSON.stringify(OVERPASS_RESP));
    if (u.includes("barberbrothers")) return new Response(WEAK_SITE_HTML, { status: 200 });
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("rurociąg leadów end-to-end (realne kształty odpowiedzi API)", () => {
  it("findLeads: geokoduje, odpytuje Overpass, zapisuje pełne dane firm", async () => {
    const r = await findLeads({ niche: "fryzjer", location: "Kraków" });
    expect(r.error).toBeUndefined();
    expect(r.city).toContain("Kraków");
    expect(r.added).toBe(2); // dwie nazwane firmy; bez nazwy odpada

    const ola = store.data.leads.find((l) => l.company.includes("Ola"))!;
    expect(ola.contact).toBe("+48 600 100 200");
    expect(ola.email).toBe("salon@ola.pl");
    expect(ola.address).toBe("Floriańska 12, Kraków");
    expect(ola.hours).toBe("Mo-Fr 09:00-18:00");
    expect(ola.note).toMatch(/Brak strony/); // bez www → oznaczona jako idealny lead
  });

  it("kolejność: firma BEZ strony i z telefonem przed firmą ze stroną", async () => {
    const r = await findLeads({ niche: "fryzjer", location: "Kraków" });
    expect(r.sample[0].company).toContain("Ola");
    expect(r.sample[0].hasWebsite).toBe(false);
  });

  it("buildDossier bez klucza AI: audyt strony + scoring zapisane w leadzie", async () => {
    await findLeads({ niche: "fryzjer", location: "Kraków" });
    const bb = store.data.leads.find((l) => l.company.includes("Barber"))!;
    const r = await buildDossier(bb.id);
    // Bez klucza AI dostajemy jasny komunikat, ale audyt i score SĄ zapisane.
    expect("error" in r && r.error).toMatch(/klucz/);
    const saved = store.data.leads.find((l) => l.id === bb.id)!;
    expect(saved.intel).toBeDefined();
    expect(saved.intel!.audit?.ok).toBe(true);
    expect(saved.intel!.audit?.viewport).toBe(false); // słaba strona wykryta
    expect(saved.intel!.score).toBeGreaterThanOrEqual(50); // słaba strona + telefon = ciepły
  });

  it("teczka leada BEZ strony: score gorący, bez audytu", async () => {
    await findLeads({ niche: "fryzjer", location: "Kraków" });
    const ola = store.data.leads.find((l) => l.company.includes("Ola"))!;
    await buildDossier(ola.id);
    const saved = store.data.leads.find((l) => l.id === ola.id)!;
    expect(saved.intel!.score).toBeGreaterThanOrEqual(75); // brak www + telefon = 🔥
    expect(saved.intel!.audit).toBeUndefined();
  });

  it("smsDraft: zaczepka dopasowana do sytuacji firmy", async () => {
    await findLeads({ niche: "fryzjer", location: "Kraków" });
    const ola = store.data.leads.find((l) => l.company.includes("Ola"))!;
    const sms = smsDraft(ola);
    expect(sms).toMatch(/nie ma strony www/);
    expect(sms).toMatch(/Kraków/);
    expect(sms.length).toBeLessThan(400);
  });
});
