import { describe, it, expect } from "vitest";
import { followUps } from "../src/lib/followups";
import { PRESETS } from "../src/lib/prompts";

describe("followUps — sugestie dalszych pytań", () => {
  it("krótka/pytająca odpowiedź → brak sugestii", () => {
    expect(followUps("", "ok")).toEqual([]);
    expect(followUps("", "Jaki masz na to budżet?")).toEqual([]);
  });

  it("trafne tematycznie najpierw, potem uniwersalne; bez powtórek; limit", () => {
    const r = followUps("napisz funkcję", "Oto przykładowy kod: const f = () => 42; który robi swoje i jest gotowy do użycia.");
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r[0]).toMatch(/komentarze i testy/i); // tematyczna (kod)
    expect(new Set(r).size).toBe(r.length);       // brak duplikatów
  });

  it("dłuższa zwykła odpowiedź → uniwersalne sugestie", () => {
    const r = followUps("opowiedz o Rzymie", "Rzym to stolica Włoch z bogatą, wielowiekową historią, którą warto poznać dokładniej i z różnych stron.");
    expect(r.length).toBeGreaterThan(0);
  });
});

describe("PRESETS — biblioteka promptów", () => {
  it("każdy starter ma id, tytuł, ikonę i pełną treść polecenia", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
      expect(p.text.length).toBeGreaterThan(20);
    }
  });
  it("identyfikatory są unikalne", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
});
