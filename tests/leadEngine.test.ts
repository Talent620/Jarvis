// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { parseElement, nicheToOverpass, toOverpassBbox, buildOverpassQuery, saveLeads, resolveLeadCount, passesFilters, scoreLead, parseWebLead, mergeRawLeads, extractEmails, enrichLeadsEmails, type RawLead } from "../src/lib/leads";
import { vi } from "vitest";
import { store } from "../src/lib/store";

describe("silnik leadów (OSM) — czyste funkcje", () => {
  it("parseElement wyciąga nazwę, telefon, stronę, adres", () => {
    const el = { tags: { name: "Salon Ola", "contact:phone": "+48 600 100 200", website: "https://salonola.pl", "addr:street": "Rynek", "addr:housenumber": "5", "addr:city": "Kraków", shop: "hairdresser" } };
    const lead = parseElement(el)!;
    expect(lead.company).toBe("Salon Ola");
    expect(lead.phone).toBe("+48 600 100 200");
    expect(lead.website).toBe("https://salonola.pl");
    expect(lead.address).toBe("Rynek 5, Kraków");
    expect(lead.kind).toBe("hairdresser");
    expect(lead.hasWebsite).toBe(true);
  });

  it("parseElement: brak nazwy → null; brak strony → hasWebsite false", () => {
    expect(parseElement({ tags: { phone: "123" } })).toBeNull();
    expect(parseElement({ tags: { name: "Bar X", amenity: "bar" } })!.hasWebsite).toBe(false);
  });

  it("nicheToOverpass mapuje polskie nisze na tagi OSM (odporne na odmianę)", () => {
    expect(nicheToOverpass("fryzjer")).toContain("hairdresser");
    expect(nicheToOverpass("warsztat samochodowy")).toContain("car_repair");
    expect(nicheToOverpass("restauracja")).toContain("restaurant");
    expect(nicheToOverpass("coś dziwnego")).toBeNull(); // → szerokie wyszukiwanie
    expect(nicheToOverpass("")).toBeNull();
  });

  it("toOverpassBbox przestawia kolejność z Nominatim (S,W,N,E)", () => {
    // Nominatim: [minLat, maxLat, minLon, maxLon]
    const bb = toOverpassBbox(["50.0", "50.1", "19.9", "20.0"]);
    expect(bb).toEqual([50.0, 19.9, 50.1, 20.0]);
    expect(toOverpassBbox(["x", "y"])).toBeNull();
  });

  it("buildOverpassQuery: nisza → wąskie zapytanie; brak → szerokie (shop/craft/office)", () => {
    const bbox: [number, number, number, number] = [50, 19, 51, 20];
    expect(buildOverpassQuery(bbox, "fryzjer")).toContain("hairdresser");
    const broad = buildOverpassQuery(bbox);
    expect(broad).toContain('["shop"]');
    expect(broad).toContain('["craft"]');
    expect(broad).toContain('["office"]');
  });

  it("szerokie szukanie obejmuje też gastronomię/zdrowie/turystykę (nie tylko sklepy)", () => {
    const broad = buildOverpassQuery([50, 19, 51, 20]);
    expect(broad).toMatch(/restaurant|cafe|fast_food/);
    expect(broad).toContain('["healthcare"]');
    expect(broad).toMatch(/tourism.*hotel/);
    expect(broad).toMatch(/leisure.*fitness/);
  });

  it("nieznana nisza → szukanie po NAZWIE w kategoriach biznesowych", () => {
    const q = buildOverpassQuery([50, 19, 51, 20], "solarium");
    expect(q).toMatch(/\["name"~"solarium",i\]/);
    expect(q).toContain('["shop"]');
  });

  it("nowe nisze mapują się na tagi (lodziarnia, pralnia, krawiec, szewc)", () => {
    expect(nicheToOverpass("lodziarnia")).toContain("ice_cream");
    expect(nicheToOverpass("pralnia")).toContain("laundry");
    expect(nicheToOverpass("krawiec")).toContain("tailor");
    expect(nicheToOverpass("szewc")).toContain("shoemaker");
  });

  it("resolveLeadCount: opcja > ustawienie > 15, ograniczone do 3–50", () => {
    expect(resolveLeadCount(25, 15)).toBe(25);       // opcja wygrywa
    expect(resolveLeadCount(undefined, 30)).toBe(30); // ustawienie
    expect(resolveLeadCount(undefined, undefined)).toBe(15); // domyślnie
    expect(resolveLeadCount(999, 0)).toBe(50);        // górny limit
    expect(resolveLeadCount(1, 0)).toBe(3);           // dolny limit
  });
});

describe("leady — filtry kanałowe i scoring", () => {
  const mk = (o: Partial<RawLead>): RawLead => ({ company: o.company || "X", hasWebsite: !!o.website, ...o } as RawLead);

  it("passesFilters: e-mail/telefon/bez-strony", () => {
    expect(passesFilters(mk({ email: "a@b.pl" }), { onlyWithEmail: true })).toBe(true);
    expect(passesFilters(mk({ phone: "600" }), { onlyWithEmail: true })).toBe(false);
    expect(passesFilters(mk({ phone: "600" }), { onlyWithPhone: true })).toBe(true);
    expect(passesFilters(mk({ website: "https://x.pl" }), { onlyNoWebsite: true })).toBe(false);
    expect(passesFilters(mk({}), {})).toBe(true);
  });
  it("scoreLead: bez strony + e-mail > z telefonem > ze stroną", () => {
    const a = scoreLead(mk({ email: "a@b.pl", address: "ul. X" }));      // bez strony + email + adres
    const b = scoreLead(mk({ phone: "600" }));                            // bez strony + telefon
    const c = scoreLead(mk({ website: "https://x.pl", phone: "600" }));   // ze stroną
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
});

describe("leady — wzbogacanie z sieci (Tavily)", () => {
  it("parseWebLead: firma z tytułu, e-mail/telefon z treści, katalog → bez 'ma stronę'", () => {
    const lead = parseWebLead({ title: "Salon Anna — Kraków | Panorama Firm", url: "https://panoramafirm.pl/x", content: "tel 600 100 200, kontakt anna@salon.pl" }, "fryzjer", "Kraków")!;
    expect(lead.company).toBe("Salon Anna");
    expect(lead.email).toBe("anna@salon.pl");
    expect(lead.phone).toMatch(/600/);
    expect(lead.hasWebsite).toBe(false); // panoramafirm to katalog, nie strona firmy
  });
  it("parseWebLead: własna domena → traktowana jako strona; brak kontaktu → null", () => {
    const a = parseWebLead({ title: "Pizzeria Roma", url: "https://pizzeria-roma.pl", content: "najlepsza pizza" }, undefined, "Kraków")!;
    expect(a.hasWebsite).toBe(true);
    expect(parseWebLead({ title: "Nic", url: "https://panoramafirm.pl/y", content: "brak danych" })).toBeNull();
  });
  it("mergeRawLeads: dedup OSM+web po nazwie/telefonie, sort wg jakości", () => {
    const osm: RawLead[] = [{ company: "Roma", phone: "600100200", hasWebsite: false } as RawLead];
    const web: RawLead[] = [{ company: "Roma", phone: "600 100 200", hasWebsite: false } as RawLead, { company: "Nova", email: "n@x.pl", hasWebsite: false } as RawLead];
    const merged = mergeRawLeads(osm, web, 10);
    expect(merged).toHaveLength(2); // Roma zdublowana po telefonie
    expect(merged[0].company).toBe("Nova"); // e-mail → wyższy score
  });
});

describe("leady — wyłuskiwanie e-maila ze strony", () => {
  it("extractEmails: mailto/tekst, deobfuskacja, preferuje domenę i kontakt", () => {
    const html = `<a href="mailto:biuro@salonola.pl">napisz</a> reklama: ad@googleapis.com, info [małpa] salonola [kropka] pl`;
    const out = extractEmails(html, "salonola.pl");
    expect(out[0]).toBe("biuro@salonola.pl");      // własna domena + prefiks kontaktowy na górze
    expect(out).toContain("info@salonola.pl");      // deobfuskacja [małpa]/[kropka]
    expect(out).not.toContain("ad@googleapis.com"); // śmieci odsiane
  });
  it("extractEmails: odrzuca pliki i przykłady", () => {
    expect(extractEmails("logo@2x.png your-email@example.com name@domain.com")).toEqual([]);
  });

  it("enrichLeadsEmails: dokłada e-mail ze strony leadom z www bez maila (fetch mock)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<a href="mailto:kontakt@firma.pl">x</a>', { status: 200 })));
    const leads: RawLead[] = [
      { company: "Firma", website: "https://firma.pl", hasWebsite: true } as RawLead,
      { company: "MaMail", email: "x@x.pl", website: "https://x.pl", hasWebsite: true } as RawLead,
    ];
    const out = await enrichLeadsEmails(leads, 5);
    expect(out[0].email).toBe("kontakt@firma.pl"); // dołożony
    expect(out[1].email).toBe("x@x.pl");            // istniejący nietknięty
    vi.unstubAllGlobals();
  });
});

describe("zapis leadów", () => {
  beforeEach(() => store.setData((d) => { d.leads = []; }));

  it("saveLeads dodaje nowe, dedupuje po nazwie, oznacza brak strony", () => {
    const raws = [
      { company: "Firma A", phone: "111", hasWebsite: false },
      { company: "Firma B", website: "https://b.pl", hasWebsite: true },
      { company: "firma a", hasWebsite: false }, // duplikat (case-insensitive)
    ];
    const added = saveLeads(raws as any, "fryzjer", "Kraków");
    expect(added).toHaveLength(2);
    const a = store.data.leads.find((l) => l.company === "Firma A")!;
    expect(a.contact).toBe("111");
    expect(a.note).toMatch(/Brak strony/);
    expect(a.location).toBe("Kraków");
  });
});
