// @vitest-environment jsdom
// === Test ZACHOWANIA tablicy lejka: upuszczenie karty na inną kolumnę zmienia etap w store ===
// Montujemy SalesBoard, symulujemy dragstart karty + drop na kolumnie „Oferta" i sprawdzamy,
// że status leada realnie się zmienił + doszedł ślad w osi czasu.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SalesBoard from "../src/components/SalesBoard";
import { store } from "../src/lib/store";
import type { Lead } from "../src/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

const LEAD: Lead = { id: "B1", company: "Firma Testowa", status: "new", createdAt: 1, updatedAt: 1, notes: [] } as Lead;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(SalesBoard, {})); });
}

beforeEach(() => { store.setData((d) => { d.leads = [{ ...LEAD, notes: [] }]; }); });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); });

describe("SalesBoard — kanban lejka", () => {
  it("renderuje kolumny etapów i kartę leada", async () => {
    await mount();
    expect(container.textContent).toContain("Firma Testowa");
    expect(container.textContent).toContain("Nowy");
    expect(container.textContent).toContain("Oferta");
  });

  it("przeciągnięcie karty na kolumnę „Oferta” zmienia status + dopisuje ślad w osi", async () => {
    await mount();
    const card = container.querySelector('[data-testid="card-B1"]') as HTMLElement;
    const offerCol = container.querySelector('[data-testid="col-offer"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(offerCol).toBeTruthy();

    await act(async () => { card.dispatchEvent(new MouseEvent("dragstart", { bubbles: true })); });
    await act(async () => {
      const over = new Event("dragover", { bubbles: true, cancelable: true });
      offerCol.dispatchEvent(over);
      offerCol.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });

    const l = store.data.leads.find((x) => x.id === "B1")!;
    expect(l.status).toBe("offer");
    expect((l.notes || []).some((n) => /Etap zmieniony/.test(n.text))).toBe(true);
  });

  it("pusta lista → czytelny komunikat, nie pusty ekran", async () => {
    store.setData((d) => { d.leads = []; });
    await mount();
    expect(container.textContent).toMatch(/Brak leadów/i);
  });
});
