// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../src/lib/store";
import {
  priceChange,
  applyObservation,
  addWatch,
  findWatch,
  removeWatch,
  setTarget,
  recordObservation,
  loadWatches,
} from "../src/lib/bargainWatch";
import type { WatchedItem } from "../src/types";

beforeEach(() => {
  store.setData((d) => { d.bargainWatch = []; });
});

const mk = (over: Partial<WatchedItem> = {}): WatchedItem => ({
  id: "x", query: "lampa", createdAt: 1, ...over,
});

describe("priceChange", () => {
  it("rozpoznaje pierwszy pomiar", () => {
    expect(priceChange(undefined, 100).dir).toBe("new");
  });
  it("rozpoznaje spadek i liczy procent", () => {
    const c = priceChange(100, 80);
    expect(c.dir).toBe("down");
    expect(c.delta).toBe(-20);
    expect(c.pct).toBe(-20);
  });
  it("rozpoznaje wzrost", () => {
    expect(priceChange(100, 130).dir).toBe("up");
  });
  it("rozpoznaje brak zmiany", () => {
    expect(priceChange(100, 100).dir).toBe("same");
  });
  it("ignoruje nieprawidłową nową cenę", () => {
    expect(priceChange(100, 0).dir).toBe("same");
  });
});

describe("applyObservation", () => {
  it("ustawia rekord przy pierwszym pomiarze", () => {
    const o = applyObservation(mk(), 120, "PLN", 1000);
    expect(o.change.dir).toBe("new");
    expect(o.item.bestPrice).toBe(120);
    expect(o.item.lastPrice).toBe(120);
    expect(o.item.lastCheckedAt).toBe(1000);
  });
  it("aktualizuje rekord, gdy taniej", () => {
    const o = applyObservation(mk({ bestPrice: 120, lastPrice: 120 }), 90, "PLN");
    expect(o.change.dir).toBe("down");
    expect(o.item.bestPrice).toBe(90);
  });
  it("trzyma rekord, gdy drożej (best się nie pogarsza)", () => {
    const o = applyObservation(mk({ bestPrice: 90, lastPrice: 90 }), 150, "PLN");
    expect(o.change.dir).toBe("up");
    expect(o.item.bestPrice).toBe(90); // najniższa widziana zostaje
    expect(o.item.lastPrice).toBe(150);
  });
  it("wykrywa osiągnięcie celu", () => {
    const below = applyObservation(mk({ targetPrice: 100, lastPrice: 120 }), 95, "PLN");
    expect(below.hitTarget).toBe(true);
    const above = applyObservation(mk({ targetPrice: 100, lastPrice: 120 }), 110, "PLN");
    expect(above.hitTarget).toBe(false);
  });
});

describe("watchlist (store)", () => {
  it("dodaje i znajduje po znormalizowanej nazwie", () => {
    addWatch("Lampa do Golfa", 50, "PLN");
    expect(loadWatches()).toHaveLength(1);
    expect(findWatch("lampa do golfa")?.bestPrice).toBe(50);
  });
  it("nie duplikuje — ponowny add zwraca istniejący", () => {
    const a = addWatch("rower", 800);
    const b = addWatch("Rower", 700);
    expect(a.id).toBe(b.id);
    expect(loadWatches()).toHaveLength(1);
  });
  it("ustawia próg przy ponownym add", () => {
    const w = addWatch("monitor", 1200);
    addWatch("monitor", undefined, undefined, 900);
    expect(findWatch("monitor")?.targetPrice).toBe(900);
    expect(w.id).toBe(findWatch("monitor")?.id);
  });
  it("recordObservation zapisuje spadek i aktualizuje rekord", () => {
    addWatch("aparat", 2000, "PLN");
    const obs = recordObservation("aparat", 1500, "PLN");
    expect(obs?.change.dir).toBe("down");
    expect(findWatch("aparat")?.bestPrice).toBe(1500);
  });
  it("recordObservation zwraca null dla nieobserwowanego", () => {
    expect(recordObservation("czego-nie-ma", 10)).toBeNull();
  });
  it("setTarget i removeWatch działają", () => {
    const w = addWatch("klawiatura", 300);
    setTarget(w.id, 200);
    expect(findWatch("klawiatura")?.targetPrice).toBe(200);
    removeWatch(w.id);
    expect(loadWatches()).toHaveLength(0);
  });
});
