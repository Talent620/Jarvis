// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { extractEntities, upsertEntity, entityConfidence, recordWorld, getWorld, recallEntities, worldSummary } from "../src/lib/worldModel";
import { store } from "../src/lib/store";

beforeEach(() => store.setData((d) => { d.world = { entities: [], relations: [] }; }));

describe("worldModel — ekstrakcja encji (pure)", () => {
  it("firma: 'firma Nova', 'X sp. z o.o.', 'Y S.A.'", () => {
    const e = extractEntities("Mam spotkanie z firmą Nova oraz Kowalski sp. z o.o.");
    const companies = e.filter((x) => x.kind === "company").map((x) => x.name.toLowerCase());
    expect(companies.some((c) => c.includes("nova"))).toBe(true);
    expect(companies.some((c) => c.includes("kowalski"))).toBe(true);
  });
  it("projekt: 'projekt Apollo'", () => {
    const e = extractEntities("Pracuję nad projektem Apollo dla klienta.");
    expect(e.some((x) => x.kind === "project" && /apollo/i.test(x.name))).toBe(true);
  });
  it("osoba: 'spotkanie z Anną', 'pan Nowak'", () => {
    const e = extractEntities("Spotkanie z Anną, potem dzwonię do pana Nowaka.");
    const people = e.filter((x) => x.kind === "person").map((x) => x.name);
    expect(people.some((p) => /Ann/i.test(p))).toBe(true);
    expect(people.some((p) => /Nowak/i.test(p))).toBe(true);
  });
  it("nie wymyśla encji z prostego tekstu bez sygnałów", () => {
    expect(extractEntities("która godzina i jaka pogoda")).toEqual([]);
  });
  it("NIE łapie małych liter jako encji (regresja: flaga i)", () => {
    // „projekt na jutro" nie jest projektem „na jutro"; „spotkanie z marcinem" (mała litera) nie jest osobą
    expect(extractEntities("projekt na jutro").some((e) => e.kind === "project")).toBe(false);
    expect(extractEntities("to była sa decyzja").some((e) => e.kind === "company")).toBe(false);
    expect(extractEntities("spotkanie z marcinem jutro").some((e) => e.kind === "person")).toBe(false);
  });
  it("nadal łapie poprawne, pisane wielką literą (Projekt na początku zdania)", () => {
    expect(extractEntities("Projekt Apollo rusza").some((e) => e.kind === "project" && /apollo/i.test(e.name))).toBe(true);
    expect(extractEntities("Spotkanie z Anną o 14").some((e) => e.kind === "person" && /Ann/i.test(e.name))).toBe(true);
    expect(extractEntities("podpisaliśmy z Acme sp. z o.o.").some((e) => e.kind === "company")).toBe(true);
  });
});

describe("worldModel — upsert i pewność", () => {
  it("upsertEntity scala po znormalizowanej nazwie i podbija wzmianki/pewność", () => {
    const list: any[] = [];
    upsertEntity(list, "person", "Anna", 1000);
    upsertEntity(list, "person", "anna", 2000); // ta sama osoba (case)
    expect(list).toHaveLength(1);
    expect(list[0].mentions).toBe(2);
    expect(list[0].lastSeen).toBe(2000);
  });
  it("entityConfidence rośnie z liczbą wzmianek (z nasyceniem)", () => {
    expect(entityConfidence(1)).toBeLessThan(entityConfidence(5));
    expect(entityConfidence(20)).toBeLessThanOrEqual(1);
    expect(entityConfidence(20)).toBeGreaterThan(entityConfidence(3));
  });
});

describe("worldModel — zapis do grafu + recall", () => {
  it("recordWorld dodaje encje i relacje współwystępowania", () => {
    recordWorld("Spotkanie z Anną w sprawie projektu Apollo dla firmy Nova.");
    const w = getWorld();
    expect(w.entities.length).toBeGreaterThanOrEqual(2);
    expect(w.relations.length).toBeGreaterThanOrEqual(1); // powiązanie współwystępujących
  });
  it("powtórzone wzmianki podbijają pewność, nie duplikują", () => {
    recordWorld("projekt Apollo");
    recordWorld("znowu projekt Apollo");
    const apollo = getWorld().entities.filter((e) => /apollo/i.test(e.name));
    expect(apollo).toHaveLength(1);
    expect(apollo[0].mentions).toBe(2);
  });
  it("recallEntities znajduje po nazwie; worldSummary zwraca tekst", () => {
    recordWorld("projekt Apollo dla firmy Nova");
    expect(recallEntities("apollo").length).toBeGreaterThanOrEqual(1);
    expect(typeof worldSummary()).toBe("string");
  });
});
