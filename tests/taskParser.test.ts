import { describe, it, expect } from "vitest";
import { parseQuickTask, resolveDueWord, nextRepeat } from "../src/lib/taskParser";

// Środa, 2026-06-10, jako stały punkt odniesienia.
const WED = new Date("2026-06-10T09:00:00");

describe("parseQuickTask — naturalne dodawanie (styl Nozbe)", () => {
  it("wyłuskuje projekt, kontekst, osobę, priorytet i termin; reszta to tytuł", () => {
    const r = parseQuickTask("Zadzwoń do Kowalskiego #Strona-Kowalski @telefon ! jutro +Marek", WED);
    expect(r.title).toBe("Zadzwoń do Kowalskiego");
    expect(r.projectName).toBe("Strona Kowalski"); // myślniki → spacje
    expect(r.category).toBe("telefon");
    expect(r.owner).toBe("Marek");
    expect(r.priority).toBe(true);
    expect(r.due).toBe("2026-06-11");
  });

  it("samo zadanie bez tokenów — tytuł, brak priorytetu", () => {
    const r = parseQuickTask("Kup mleko", WED);
    expect(r.title).toBe("Kup mleko");
    expect(r.priority).toBe(false);
    expect(r.due).toBeUndefined();
    expect(r.projectName).toBeUndefined();
  });

  it("slowo priorytet dziala jak wykrzyknik", () => {
    expect(parseQuickTask("Wyślij fakturę priorytet", WED).priority).toBe(true);
  });

  it("powtarzalność z *tydzień / *codziennie", () => {
    expect(parseQuickTask("Podlej kwiaty *codziennie", WED).repeat).toBe("daily");
    expect(parseQuickTask("Raport *tydzień", WED).repeat).toBe("weekly");
    expect(parseQuickTask("Czynsz *miesiąc", WED).repeat).toBe("monthly");
  });

  it("tokeny w dowolnej kolejności", () => {
    const r = parseQuickTask("@dom #Remont !  Pomaluj ścianę dziś", WED);
    expect(r.title).toBe("Pomaluj ścianę");
    expect(r.category).toBe("dom");
    expect(r.projectName).toBe("Remont");
    expect(r.priority).toBe(true);
    expect(r.due).toBe("2026-06-10");
  });
});

describe("resolveDueWord — terminy naturalne", () => {
  it("dziś / jutro / pojutrze", () => {
    expect(resolveDueWord("dziś", WED)).toBe("2026-06-10");
    expect(resolveDueWord("jutro", WED)).toBe("2026-06-11");
    expect(resolveDueWord("pojutrze", WED)).toBe("2026-06-12");
  });
  it("dzień tygodnia → najbliższy przyszły (piątek po środzie = +2)", () => {
    expect(resolveDueWord("piątek", WED)).toBe("2026-06-12");
    expect(resolveDueWord("pt", WED)).toBe("2026-06-12");
    // środa „w środę" = za tydzień, nie dziś
    expect(resolveDueWord("środa", WED)).toBe("2026-06-17");
  });
  it("formaty dat: dd.mm i ISO; przeszła data dd.mm → przyszły rok", () => {
    expect(resolveDueWord("15.08", WED)).toBe("2026-08-15");
    expect(resolveDueWord("2027-01-02", WED)).toBe("2027-01-02");
    expect(resolveDueWord("01.01", WED)).toBe("2027-01-01"); // już minęło w 2026 → 2027
  });
  it("nie-termin → null", () => {
    expect(resolveDueWord("mleko", WED)).toBeNull();
  });
});

describe("nextRepeat — kolejny termin powtarzalnego zadania", () => {
  it("codziennie/tygodniowo/miesięcznie idzie do przodu", () => {
    expect(nextRepeat("2026-06-10", "daily", WED)).toBe("2026-06-11");
    expect(nextRepeat("2026-06-10", "weekly", WED)).toBe("2026-06-17");
    expect(nextRepeat("2026-06-10", "monthly", WED)).toBe("2026-07-10");
  });
  it("zaległy termin przeskakuje do najbliższego przyszłego", () => {
    // termin 2026-06-01 (przeszły), dziś środa 06-10, weekly → pierwszy przyszły
    const r = nextRepeat("2026-06-01", "weekly", WED);
    expect(r >= "2026-06-10").toBe(true);
  });
});
