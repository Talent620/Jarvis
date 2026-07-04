import { describe, it, expect } from "vitest";
import { fuzzyScore, scoreCommand, rankCommands, type CommandItem } from "../src/lib/commandPalette";

describe("commandPalette — fuzzyScore", () => {
  it("podciąg bije fuzzy; początek słowa premiowany", () => {
    const sub = fuzzyScore("ust", "Ustawienia");
    const fuzzy = fuzzyScore("stw", "Ustawienia");
    expect(sub).toBeGreaterThan(0.7);
    expect(fuzzy).toBeGreaterThan(0);
    expect(sub).toBeGreaterThan(fuzzy);
  });
  it("brak wszystkich znaków po kolei → -1 (odrzucone)", () => {
    expect(fuzzyScore("xyz", "Ustawienia")).toBe(-1);
    expect(fuzzyScore("aings", "Ustawienia")).toBe(-1); // zła kolejność
  });
  it("puste zapytanie → 0 (neutralne)", () => {
    expect(fuzzyScore("", "cokolwiek")).toBe(0);
  });
  it("ignoruje polskie diakrytyki (glos ↔ Głos, zlec ↔ Zleć)", () => {
    expect(fuzzyScore("glos", "Głos")).toBeGreaterThan(0.7);
    expect(fuzzyScore("zlec cel", "🎯 Zleć cel")).toBeGreaterThan(0);
    expect(fuzzyScore("zadania", "Zadania Pro")).toBeGreaterThan(0.7);
  });
});

const cmd = (id: string, title: string, keywords?: string): CommandItem => ({ id, title, keywords, run: () => {} });

describe("commandPalette — rankCommands", () => {
  const items = [
    cmd("settings", "Ustawienia"),
    cmd("voice", "Głos", "mowa audio"),
    cmd("goal", "🎯 Zleć cel", "do-for-me cel projekt"),
    cmd("sales", "Pulpit Sprzedaży", "leady crm"),
    cmd("studio", "Studio Obrazów", "zdjecia edycja"),
  ];

  it("trafia po tytule i po słowach kluczowych", () => {
    expect(rankCommands("glos", items)[0].id).toBe("voice");
    expect(rankCommands("leady", items)[0].id).toBe("sales"); // tylko w keywords
    expect(rankCommands("cel", items)[0].id).toBe("goal");
  });
  it("puste zapytanie → naturalna kolejność, ucięte do limitu", () => {
    expect(rankCommands("", items, 3).map((c) => c.id)).toEqual(["settings", "voice", "goal"]);
  });
  it("brak trafień → pusto", () => {
    expect(rankCommands("zzzz", items)).toEqual([]);
  });
  it("stabilny przy remisie (kolejność wejścia)", () => {
    const tie = [cmd("a", "Raport"), cmd("b", "Raport")];
    expect(rankCommands("raport", tie).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("commandPalette — scoreCommand (tytuł > keywords > hint)", () => {
  it("tytuł ma najwyższą wagę", () => {
    const c: CommandItem = { id: "x", title: "Głos", keywords: "ustawienia", hint: "audio", run: () => {} };
    expect(scoreCommand("glos", c)).toBeGreaterThan(scoreCommand("ustawienia", c));
  });
});
