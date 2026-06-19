// @vitest-environment jsdom
// Weryfikacja AUTONOMII: runProspecting sam wyszukuje leady i (opcjonalnie) pisze oferty,
// bez udziału użytkownika. Mockujemy sieć (findLeads), AI (draftOffer) i powiadomienia.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/lib/leads", () => ({ findLeads: vi.fn() }));
vi.mock("../src/lib/offer", () => ({ draftOffer: vi.fn() }));
vi.mock("../src/lib/notifications", () => ({ notify: vi.fn() }));

import { runProspecting } from "../src/lib/prospect";
import { findLeads } from "../src/lib/leads";
import { draftOffer } from "../src/lib/offer";
import { notify } from "../src/lib/notifications";
import { store } from "../src/lib/store";
import type { Lead } from "../src/types";

const lead = (id: string, company: string): Lead => ({ id, company, status: "new", createdAt: 0, updatedAt: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  store.setData((d) => { d.leads = []; });
  store.setSettings({ prospectLocation: "", prospectNiche: "", autoDraftOffers: false });
});

describe("autonomia — runProspecting", () => {
  it("bez ustawionego miasta → czytelny błąd, NIE strzela do sieci", async () => {
    const r = await runProspecting();
    expect(r.added).toBe(0);
    expect(r.error).toMatch(/miasto/i);
    expect(findLeads).not.toHaveBeenCalled();
  });

  it("z miastem → sam wyszukuje leady i powiadamia (bez auto-ofert, gdy wyłączone)", async () => {
    store.setSettings({ prospectLocation: "Kraków", prospectNiche: "fryzjer", autoDraftOffers: false });
    const a = lead("a", "Alfa"), b = lead("b", "Beta");
    store.setData((d) => { d.leads = [a, b]; });
    vi.mocked(findLeads).mockResolvedValue({ added: 2, found: 2, city: "Kraków", sample: [], addedLeads: [a, b] });

    const r = await runProspecting();
    expect(r.added).toBe(2);
    expect(findLeads).toHaveBeenCalledWith({ niche: "fryzjer", location: "Kraków", count: 15 });
    expect(draftOffer).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("autoDraftOffers → sam pisze oferty (limit 3) i ustawia status 'offer'", async () => {
    store.setSettings({ prospectLocation: "Gdańsk", autoDraftOffers: true });
    const added = ["a", "b", "c", "d", "e"].map((id) => lead(id, id.toUpperCase()));
    store.setData((d) => { d.leads = [...added]; });
    vi.mocked(findLeads).mockResolvedValue({ added: 5, found: 5, city: "Gdańsk", sample: [], addedLeads: added });
    vi.mocked(draftOffer).mockResolvedValue("Temat: Oferta\n\nDzień dobry!");

    const r = await runProspecting();
    expect(r.added).toBe(5);
    expect(draftOffer).toHaveBeenCalledTimes(3); // twardy limit kosztów: pierwsze 3
    const a = store.data.leads.find((l) => l.id === "a")!;
    expect(a.offer).toContain("Oferta");
    expect(a.status).toBe("offer");
    // czwarty lead poza limitem — bez oferty, status bez zmian
    expect(store.data.leads.find((l) => l.id === "d")!.offer).toBeUndefined();
    expect(store.data.leads.find((l) => l.id === "d")!.status).toBe("new");
  });

  it("błąd wyszukiwania → propaguje, nie wywala się", async () => {
    store.setSettings({ prospectLocation: "Łódź" });
    vi.mocked(findLeads).mockResolvedValue({ added: 0, found: 0, city: "Łódź", sample: [], addedLeads: [], error: "Nie znalazłem firm." });
    const r = await runProspecting();
    expect(r).toEqual({ added: 0, error: "Nie znalazłem firm." });
    expect(notify).not.toHaveBeenCalled();
  });

  it("draftOffer zwraca pusto (np. chwilowy błąd AI) → lead bez oferty, ale prospecting nie pada", async () => {
    store.setSettings({ prospectLocation: "Poznań", autoDraftOffers: true });
    const a = lead("a", "Alfa");
    store.setData((d) => { d.leads = [a]; });
    vi.mocked(findLeads).mockResolvedValue({ added: 1, found: 1, city: "Poznań", sample: [], addedLeads: [a] });
    vi.mocked(draftOffer).mockResolvedValue("");

    const r = await runProspecting();
    expect(r.added).toBe(1);
    expect(store.data.leads.find((l) => l.id === "a")!.offer).toBeUndefined();
    expect(store.data.leads.find((l) => l.id === "a")!.status).toBe("new"); // bez oferty status zostaje
  });
});
