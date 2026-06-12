// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { schedule, addCard, reviewCard, dueCards, dueCount, cardStats } from "../src/lib/cards";
import { store } from "../src/lib/store";
import type { Flashcard } from "../src/types";

const fresh = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: "c1", front: "q", back: "a", ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), createdAt: Date.now(), ...over,
});
const DAY = 86_400_000;

describe("SM-2 — harmonogram powtórek", () => {
  it("pierwsze udane przypomnienie → interwał 1 dzień", () => {
    const c = schedule(fresh(), "good");
    expect(c.reps).toBe(1);
    expect(c.interval).toBe(1);
    expect(Math.round((c.due - Date.now()) / DAY)).toBe(1);
  });

  it("drugie udane → 6 dni, trzecie → interval×ease", () => {
    let c = schedule(fresh(), "good"); // reps1, int1
    c = schedule(c, "good"); // reps2, int6
    expect(c.interval).toBe(6);
    const ease = c.ease;
    c = schedule(c, "good"); // reps3, int = round(6*ease)
    expect(c.interval).toBe(Math.round(6 * ease));
  });

  it("ocena again resetuje (lapse): reps=0, interwał 1 dzień, lapses+1", () => {
    let c = schedule(fresh(), "good");
    c = schedule(c, "good");
    c = schedule(c, "again");
    expect(c.reps).toBe(0);
    expect(c.interval).toBe(1);
    expect(c.lapses).toBe(1);
  });

  it("łatwość nie spada poniżej 1.3 nawet po wielu trudnych", () => {
    let c = fresh();
    for (let i = 0; i < 12; i++) c = schedule(c, "again");
    expect(c.ease).toBeGreaterThanOrEqual(1.3);
  });

  it("łatwe podnosi ease, trudne obniża", () => {
    expect(schedule(fresh(), "easy").ease).toBeGreaterThan(2.5);
    expect(schedule(fresh(), "hard").ease).toBeLessThan(2.5);
  });
});

describe("Kapsuły — magazyn i kolejka", () => {
  beforeEach(() => store.setData((d) => { d.flashcards = []; }));

  it("nowa fiszka jest od razu do powtórki (due ≤ teraz)", () => {
    addCard("Stolica Polski?", "Warszawa", "geografia");
    expect(dueCount()).toBe(1);
    expect(dueCards()[0].front).toBe("Stolica Polski?");
  });

  it("po ocenie 'dobre' fiszka znika z dzisiejszej kolejki", () => {
    const c = addCard("2+2?", "4");
    reviewCard(c.id, "good");
    expect(dueCount()).toBe(0); // przesunięta o 1 dzień
  });

  it("statystyki liczą due/learned/talie", () => {
    addCard("a", "1", "matma");
    const c = addCard("b", "2", "matma");
    store.setData((d) => { const x = d.flashcards.find((y) => y.id === c.id); if (x) x.interval = 30; });
    const s = cardStats();
    expect(s.total).toBe(2);
    expect(s.learned).toBe(1); // interval ≥ 21
    expect(s.decks).toBe(1);
  });
});
