// @vitest-environment jsdom
// === Test ZACHOWANIA panelu Raportów: renderuje realne liczby ze store ===
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SalesReports from "../src/components/SalesReports";
import { store } from "../src/lib/store";
import type { Lead } from "../src/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

const mk = (o: Partial<Lead>): Lead => ({ id: Math.random().toString(36).slice(2), company: "F", status: "new", niche: "stolarz", createdAt: Date.now(), updatedAt: Date.now(), ...o } as Lead);

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(SalesReports)); });
}
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); });

describe("SalesReports — panel raportów", () => {
  beforeEach(() => { store.setData((d) => { d.leads = []; d.financeProjects = []; }); });

  it("pusta lista → czytelny komunikat", async () => {
    await mount();
    expect(container.textContent).toMatch(/Brak leadów/i);
  });

  it("z leadami: pokazuje lejek konwersji, sekcję segmentów i 6 miesięcy", async () => {
    store.setData((d) => { d.leads = [mk({ status: "won", value: 8000 }), mk({ status: "lost" }), mk({ status: "offer" })]; });
    await mount();
    expect(container.textContent).toContain("Lejek konwersji");
    expect(container.textContent).toContain("Co konwertuje");
    expect(container.textContent).toContain("Ostatnie 6 miesięcy");
    expect(container.textContent).toContain("stolarz");     // segment
    expect(container.textContent).toMatch(/Skuteczność/);
  });
});
