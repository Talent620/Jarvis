// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { syncSalesTasks, salesProjectId, autoPlanDaily } from "../src/lib/autoPlan";
import { store, uid } from "../src/lib/store";
import type { Lead } from "../src/types";

const NOW = new Date("2026-06-15T20:00:00"); // poniedziałek wieczór

function lead(p: Partial<Lead>): Lead {
  return { id: uid(), company: "Firma", status: "new", createdAt: 0, updatedAt: 0, ...p };
}

beforeEach(() => {
  store.setData((d) => { d.leads = []; d.tasks = []; d.projects = []; });
  store.setSettings({ salesAutopilot: true, lastAutoPlanAt: "" });
});

describe("autopilot sprzedaży — zadania z leadów", () => {
  it("tworzy zadanie 'Zadzwoń' dla gorącego, otwartego, niezaczepionego leada", () => {
    store.setData((d) => { d.leads = [lead({ company: "Salon Ola", contact: "600100200", hours: "24/7", intel: { score: 90, updatedAt: 0 } })]; });
    const r = syncSalesTasks(NOW);
    expect(r.added).toBe(1);
    const t = store.data.tasks[0];
    expect(t.title).toMatch(/Zadzwoń: Salon Ola/);
    expect(t.priority).toBe(true);
    expect(t.sourceId).toBe(`call:${store.data.leads[0].id}`);
    expect(store.data.projects.find((p) => p.name === "Sprzedaż")).toBeTruthy();
  });

  it("jest idempotentny — drugie wywołanie nie dubluje zadań", () => {
    store.setData((d) => { d.leads = [lead({ company: "A", contact: "111", hours: "24/7" })]; });
    syncSalesTasks(NOW);
    const r2 = syncSalesTasks(NOW);
    expect(r2.added).toBe(0);
    expect(store.data.tasks.filter((t) => !t.done)).toHaveLength(1);
  });

  it("auto-domyka zadanie 'Zadzwoń', gdy lead przestał być nowy (zadzwoniłeś)", () => {
    store.setData((d) => { d.leads = [lead({ id: "L1", company: "A", contact: "111", hours: "24/7" })]; });
    syncSalesTasks(NOW);
    store.setData((d) => { d.leads[0].status = "contacted"; });
    const r = syncSalesTasks(NOW);
    expect(r.completed).toBe(1);
    const callTask = store.data.tasks.find((t) => t.sourceId === "call:L1")!;
    expect(callTask.done).toBe(true);
  });

  it("tworzy follow-up dla zaczepionego leada po 3+ dniach", () => {
    const old = NOW.getTime() - 5 * 86400000;
    store.setData((d) => { d.leads = [lead({ company: "B", status: "contacted", lastContactedAt: old })]; });
    const r = syncSalesTasks(NOW);
    expect(r.added).toBe(1);
    expect(store.data.tasks[0].title).toMatch(/Follow-up: B/);
  });

  it("nie odtwarza zadania raz wykonanego w tym cyklu", () => {
    store.setData((d) => { d.leads = [lead({ id: "L1", company: "A", contact: "111", hours: "24/7" })]; });
    syncSalesTasks(NOW);
    store.setData((d) => { d.tasks[0].done = true; }); // ręcznie odhaczone, lead wciąż „new"
    const r = syncSalesTasks(NOW);
    expect(r.added).toBe(0); // ten sam sourceId istnieje (done) → nie tworzymy ponownie
  });

  it("salesProjectId reuzywa istniejący projekt Sprzedaż", () => {
    const a = salesProjectId();
    const b = salesProjectId();
    expect(a).toBe(b);
    expect(store.data.projects.filter((p) => p.name === "Sprzedaż")).toHaveLength(1);
  });

  it("autoPlanDaily uruchamia się raz dziennie i respektuje wyłączenie", () => {
    store.setData((d) => { d.leads = [lead({ company: "A", contact: "111", hours: "24/7" })]; });
    expect(autoPlanDaily(NOW)).not.toBeNull();   // pierwszy raz dziś
    expect(autoPlanDaily(NOW)).toBeNull();         // drugi raz tego samego dnia → pomijamy
    store.setSettings({ salesAutopilot: false, lastAutoPlanAt: "" });
    expect(autoPlanDaily(NOW)).toBeNull();         // wyłączony
  });
});
