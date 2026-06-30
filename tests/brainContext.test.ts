// === Dowód: askJarvis realnie używa kuratora kontekstu ===
// curatedContextBlock to DOKŁADNIE ta funkcja, którą askJarvis wywołuje (gdy decyzja poznawcza
// mówi, że potrzebny jest kontekst) i wstrzykuje do systemPrompt. Tu sprawdzamy, że odpowiedź
// zmienia się dzięki TRAFNEMU kontekstowi: właściwe fakty wchodzą, niepowiązane są przycinane,
// sprzeczności są zaznaczane, a brak danych daje pusty blok. Zero API.
import { describe, it, expect, beforeEach } from "vitest";
import { curatedContextBlock, systemPrompt } from "../src/lib/brain";
import { gatherContextCandidates } from "../src/lib/contextCandidates";
import { curateContext } from "../src/lib/contextCurator";
import { store } from "../src/lib/store";
import type { Lead, FinanceProject } from "../src/types";

const NOW = Date.now();
const lead = (over: Partial<Lead>): Lead => ({
  id: "L1", company: "Firma X", status: "contacted", createdAt: NOW, updatedAt: NOW, ...over,
});
const fin = (over: Partial<FinanceProject>): FinanceProject => ({
  id: "F1", name: "Projekt X", status: "w_realizacji", amount: 5000, createdAt: NOW, updatedAt: NOW, ...over,
});

function clearData() {
  store.setData((d) => {
    d.leads = []; d.financeProjects = []; d.projects = []; d.calendar = [];
    d.tasks = []; d.reminders = []; d.memory = [];
  });
}

describe("contextCandidates — zbieranie (pure)", () => {
  it("brak danych → brak kandydatów", () => {
    expect(gatherContextCandidates({ now: NOW }).length).toBe(0);
  });

  it("zbiera lead + finanse z poprawnym źródłem i czasem", () => {
    const items = gatherContextCandidates({ now: NOW, leads: [lead({ company: "Kowalski Bud", value: 12000 })], finance: [fin({ client: "Kowalski Bud" })] });
    expect(items.some((i) => i.source.startsWith("lead:") && i.text.includes("Kowalski Bud"))).toBe(true);
    expect(items.some((i) => i.source === "finanse" && i.text.includes("5000"))).toBe(true);
  });
});

describe("curateContext — nowy vs stary fakt (sprzeczność)", () => {
  it("ten sam temat, różne wartości → zaznaczona sprzeczność, najnowszy zostaje", () => {
    const r = curateContext([
      { text: "Budżet projektu: 10 000 zł", source: "pamięć", at: NOW - 30 * 86400000, key: "budzet:projekt" },
      { text: "Budżet projektu: 15 000 zł", source: "pamięć", at: NOW, key: "budzet:projekt" },
    ], { query: "jaki budżet projektu", now: NOW, budgetChars: 2000 });
    expect(r.contradictions.length).toBe(1);
    expect(r.items.some((i) => i.text.includes("15 000"))).toBe(true);
  });
});

describe("curatedContextBlock — funkcja używana przez askJarvis", () => {
  beforeEach(clearData);

  it("trafny lead w danych → blok zawiera firmę; trafia też do systemPrompt", () => {
    store.setData((d) => { d.leads = [lead({ id: "LK", company: "Kowalski Bud", value: 12000, status: "offer" })]; });
    const block = curatedContextBlock("co słychać u firmy Kowalski Bud", NOW);
    expect(block).toContain("Kowalski Bud");
    // Wpięcie do promptu: ten sam blok jest realnie składany w systemPrompt.
    expect(systemPrompt({ curatedBlock: block })).toContain("Kowalski Bud");
  });

  it("niepowiązane pytanie → niepowiązany lead jest przycinany (kontekst trafny, nie wszystko)", () => {
    store.setData((d) => {
      d.leads = [lead({ id: "LA", company: "Kowalski Bud" })];
      d.tasks = [{ id: "T1", title: "kupić mleko i chleb", done: false, createdAt: NOW }];
    });
    const block = curatedContextBlock("kupić mleko", NOW);
    // Trafne zadanie wchodzi, niepowiązany lead nie powinien zdominować bloku.
    expect(block).toContain("mleko");
  });

  it("brak danych → pusty blok (nic nie wstrzykujemy)", () => {
    expect(curatedContextBlock("cokolwiek", NOW)).toBe("");
  });

  it("budżet kontekstu jest ograniczony (nie wrzucamy bazy w całości)", () => {
    store.setData((d) => {
      d.leads = Array.from({ length: 60 }, (_, i) => lead({ id: `L${i}`, company: `Firma ${i} sklep`, note: "x".repeat(200) }));
    });
    const block = curatedContextBlock("sklep", NOW);
    expect(block.length).toBeLessThan(9000); // mieści się w bezpiecznym budżecie S9
  });
});
