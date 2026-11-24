// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  activeMemoryFacts,
  buildCoreMemoryBlock,
  CORE_MEMORY_MAX_RATIO,
  isFactValidAt,
  normalizeFactTopic,
} from "../src/lib/coreMemory";
import { coreMemoryBlock, memoryBlock, rememberFact, rememberTemporalFact } from "../src/lib/memory";
import { store } from "../src/lib/store";

beforeEach(() => {
  store.setData((d) => {
    d.memory = [];
  });
});

describe("Bi-temporal memory (valid_from / invalid_at) + automatyczne unieważnianie sprzeczności", () => {
  it("normalizuje synonimiczne tematy (miasto / miasto_zamieszkania)", () => {
    expect(normalizeFactTopic("miasto")).toBe("miasto");
    expect(normalizeFactTopic("miasto_zamieszkania")).toBe("miasto");
    expect(normalizeFactTopic("Nazwa firmy")).toBe("firma");
  });

  it("nowy sprzeczny fakt automatycznie ustawia invalid_at na starym zamiast duplikować w RAG", () => {
    const t1 = 1_700_000_000_000;
    const t2 = t1 + 10_000;
    const oldFact = rememberTemporalFact("miasto_zamieszkania", "Kraków", { now: t1 });
    const newFact = rememberTemporalFact("miasto", "Gdańsk", { now: t2 });

    const storedOld = store.data.memory.find((m) => m.id === oldFact.id)!;
    const storedNew = store.data.memory.find((m) => m.id === newFact.id)!;

    expect(storedOld.valid_from).toBe(t1);
    expect(storedOld.invalid_at).toBe(t2);
    expect(storedOld.superseded_by).toBe(newFact.id);
    expect(storedNew.valid_from).toBe(t2);
    expect(storedNew.invalid_at).toBeUndefined();

    // Zapytanie o stan w chwili t1 widzi Kraków; w t2 widzi wyłącznie Gdańsk.
    expect(isFactValidAt(storedOld, t1 + 1000)).toBe(true);
    expect(isFactValidAt(storedOld, t2)).toBe(false);
    expect(activeMemoryFacts(store.data.memory, t2).map((f) => f.value)).toEqual(["Gdańsk"]);

    // memoryBlock (RAG/prompt) nie duplikuje unieważnionego faktu.
    const block = memoryBlock(4000);
    expect(block).toContain("Gdańsk");
    expect(block).not.toContain("Kraków");
  });

  it("rememberFact także automatycznie unieważnia sprzeczne synonimy w pamięci", () => {
    rememberFact("miasto_zamieszkania", "Poznań");
    rememberFact("miasto", "Wrocław");
    const active = activeMemoryFacts(store.data.memory);
    expect(active.map((f) => f.value)).toEqual(["Wrocław"]);
  });
});

describe("Core Memory — twardy limit max 30% budżetu kontekstu", () => {
  it("nigdy nie przekracza 30% całkowitego budżetu kontekstu i priorytetyzuje przypięte fakty", () => {
    const now = Date.now();
    const facts = Array.from({ length: 40 }, (_, i) => ({
      id: `f_${i}`,
      key: `preferencja_${i}`,
      value: `Długi opis preferencji użytkownika numer ${i} — konkretna wartość testowa`,
      pinned: i === 39,
      createdAt: now - i * 1000,
      valid_from: now - i * 1000,
      useCount: i === 38 ? 50 : 1,
    }));

    const budget = 1000;
    const res = buildCoreMemoryBlock(facts, budget, now);
    expect(res.maxChars).toBe(Math.floor(budget * CORE_MEMORY_MAX_RATIO));
    expect(res.usedChars).toBeLessThanOrEqual(300);
    expect(res.block.length).toBeLessThanOrEqual(300);
    // Przypięty fakt i najczęściej wzmacniany wchodzą na początek Core Memory.
    expect(res.block).toContain("preferencja_39");
    expect(res.block).toContain("preferencja_38");
  });

  it("coreMemoryBlock integruje się ze store i respektuje budżet", () => {
    rememberFact("styl", "krótko i konkretnie");
    const block = coreMemoryBlock(600);
    expect(block).toContain("Core Memory");
    expect(block).toContain("krótko i konkretnie");
    expect(block.length).toBeLessThanOrEqual(180);
  });
});
