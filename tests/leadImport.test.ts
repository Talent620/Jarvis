// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { parseLeadsImport, importLeads } from "../src/lib/leadImport";
import { store } from "../src/lib/store";

describe("parseLeadsImport — różne formaty wklejki", () => {
  it("prosta lista: jedna firma na linię", () => {
    const r = parseLeadsImport("Salon Ola\nWarsztat Marek\nPiekarnia Kowalski");
    expect(r.map((x) => x.company)).toEqual(["Salon Ola", "Warsztat Marek", "Piekarnia Kowalski"]);
  });

  it("wiersz z danymi: rozpoznaje telefon, e-mail, miasto", () => {
    const r = parseLeadsImport("Salon Ola, 600 100 200, biuro@ola.pl, Kraków");
    expect(r[0].company).toBe("Salon Ola");
    expect(r[0].phone).toBe("600 100 200");
    expect(r[0].email).toBe("biuro@ola.pl");
    expect(r[0].city).toBe("Kraków");
  });

  it("CSV z nagłówkiem mapuje kolumny niezależnie od kolejności", () => {
    const csv = "E-mail;Firma;Miasto;Telefon\nbiuro@ola.pl;Salon Ola;Kraków;600100200";
    const r = parseLeadsImport(csv);
    expect(r[0].company).toBe("Salon Ola");
    expect(r[0].email).toBe("biuro@ola.pl");
    expect(r[0].city).toBe("Kraków");
    expect(r[0].phone).toBe("600100200");
  });

  it("rozpoznaje stronę www w danych", () => {
    const r = parseLeadsImport("Firma X; salonx.pl; 501502503");
    expect(r[0].company).toBe("Firma X");
    expect(r[0].url).toBe("salonx.pl");
    expect(r[0].phone).toBe("501502503");
  });

  it("pomija puste linie", () => {
    expect(parseLeadsImport("\n\n  \nFirma A\n\n")).toHaveLength(1);
  });
});

describe("importLeads — zapis z dedupem", () => {
  beforeEach(() => store.setData((d) => { d.leads = []; }));

  it("dodaje nowe i pomija duplikaty po nazwie", () => {
    store.setData((d) => { d.leads = [{ id: "x", company: "Salon Ola", status: "new", createdAt: 0, updatedAt: 0 } as any]; });
    const r = importLeads("Salon Ola, 600100200\nNowa Firma, 111222333, Gdańsk");
    expect(r.added).toBe(1);
    expect(r.total).toBe(2);
    const nowa = store.data.leads.find((l) => l.company === "Nowa Firma")!;
    expect(nowa.contact).toBe("111222333");
    expect(nowa.location).toBe("Gdańsk");
  });
});
