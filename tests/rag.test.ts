import { describe, it, expect } from "vitest";
import { cosineSim, jaccardSim, keywordScore, mmrSelect, reciprocalRankFusion } from "../src/lib/rag";

describe("rag — cosineSim", () => {
  it("identyczne wektory → 1; ortogonalne → 0; różne wymiary/puste → 0", () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSim([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSim(undefined, [1])).toBe(0);
  });
});

describe("rag — jaccardSim (fallback leksykalny)", () => {
  it("identyczny tekst → 1; rozłączny → 0", () => {
    expect(jaccardSim("kot pies dom", "kot pies dom")).toBeCloseTo(1);
    expect(jaccardSim("kot pies", "samolot rower")).toBe(0);
  });
});

describe("rag — keywordScore (leksykalna trafność, łapie dokładne słowa)", () => {
  it("ułamek różnych słów zapytania obecnych w tekście", () => {
    // "faktura"≠"fakturę" w DOKŁADNYM dopasowaniu (fleksja PL — stąd też mamy semantyczne); NIP+1234 trafiają.
    expect(keywordScore("faktura NIP 1234", "wystawiłem fakturę z numerem NIP 1234 wczoraj")).toBeCloseTo(2 / 3, 2);
    expect(keywordScore("NIP 1234", "numer NIP to 1234")).toBe(1);
    expect(keywordScore("kot pies", "tu jest kot")).toBeCloseTo(0.5);
    expect(keywordScore("samolot", "kompletnie inny tekst")).toBe(0);
  });
  it("puste zapytanie → 0; ignoruje krótkie tokeny (<3)", () => {
    expect(keywordScore("", "cokolwiek")).toBe(0);
    expect(keywordScore("a b", "a b c")).toBe(0); // 1-znakowe pomijane → brak tokenów
  });
});

describe("rag — mmrSelect (różnorodność > duplikaty)", () => {
  it("odrzuca bliski duplikat na rzecz odrębnej informacji", () => {
    // A i A2 prawie identyczne (wysoka trafność), B inny temat (niższa trafność).
    const items = [
      { id: "A", relevance: 0.95, vector: [1, 0, 0] },
      { id: "A2", relevance: 0.92, vector: [0.99, 0.01, 0] },
      { id: "B", relevance: 0.6, vector: [0, 1, 0] },
    ];
    const picked = mmrSelect(items, 2, 0.7).map((x) => x.id);
    expect(picked[0]).toBe("A"); // najtrafniejszy pierwszy
    expect(picked).toContain("B"); // różnorodność wygrywa z bliskim duplikatem A2
    expect(picked).not.toContain("A2");
  });
  it("λ=1 → czysty top-k po trafności (bez kary za podobieństwo)", () => {
    const items = [
      { id: "A", relevance: 0.95, vector: [1, 0] },
      { id: "A2", relevance: 0.9, vector: [1, 0] },
      { id: "B", relevance: 0.5, vector: [0, 1] },
    ];
    expect(mmrSelect(items, 2, 1).map((x) => x.id)).toEqual(["A", "A2"]);
  });
  it("brak wektorów → degraduje do top-k po trafności (bez wywrotki)", () => {
    const items = [{ id: "x", relevance: 0.2 }, { id: "y", relevance: 0.9 }];
    expect(mmrSelect(items, 1).map((x) => x.id)).toEqual(["y"]);
  });
  it("krawędzie: k≤0 lub pusto → []", () => {
    expect(mmrSelect([{ id: "a", relevance: 1 }], 0)).toEqual([]);
    expect(mmrSelect([], 5)).toEqual([]);
  });
});

describe("rag — reciprocalRankFusion (fuzja wielu retrieverów)", () => {
  it("element wysoko w wielu listach wygrywa", () => {
    const sem = ["a", "b", "c"];
    const lex = ["b", "a", "d"];
    const out = reciprocalRankFusion([sem, lex]);
    expect(out[0].id).toMatch(/a|b/); // a i b są wysoko w obu
    const ids = out.map((x) => x.id);
    expect(ids).toContain("d"); // unikalne też wchodzą
    // a (rank0+rank1) vs c (tylko jedna lista) → a wyżej
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("c"));
  });
  it("pusto → []", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
