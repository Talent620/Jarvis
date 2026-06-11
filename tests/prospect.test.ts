import { describe, it, expect } from "vitest";
import { leadsFromResults } from "../src/lib/prospect";

describe("auto-prospekting — wyłuskiwanie leadów", () => {
  it("wyciąga nazwę firmy z tytułu (do pierwszego separatora)", () => {
    const out = leadsFromResults([
      { title: "Salon Ola — fryzjer Kraków", url: "https://salonola.pl" },
      { title: "Barber King | najlepszy barber", url: "https://barberking.pl/o-nas" },
    ]);
    expect(out[0].company).toBe("Salon Ola");
    expect(out[1].company).toBe("Barber King");
  });

  it("używa domeny, gdy brak tytułu", () => {
    const out = leadsFromResults([{ title: "", url: "https://www.dent-med.pl/kontakt" }]);
    expect(out[0].company).toBe("dent-med.pl");
  });

  it("deduplikuje po nazwie", () => {
    const out = leadsFromResults([
      { title: "Salon Ola — fryzjer", url: "https://salonola.pl" },
      { title: "Salon Ola — cennik", url: "https://salonola.pl/cennik" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("pomija puste", () => {
    expect(leadsFromResults([{ title: "" }])).toHaveLength(0);
    expect(leadsFromResults([])).toHaveLength(0);
  });
});
