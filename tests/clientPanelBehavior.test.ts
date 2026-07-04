// @vitest-environment jsdom
// === Test ZACHOWANIA Panelu Klienta: realne kliknięcia zmieniają realny store ===
// Montujemy ClientPanel w jsdom, wstrzykujemy leada do store, klikamy etap lejka i przypomnienie —
// i sprawdzamy, że store faktycznie się zmienił (status/nextFollowUpAt) + ślad w osi czasu.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ClientPanel from "../src/components/ClientPanel";
import { store } from "../src/lib/store";
import type { Lead } from "../src/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const LEAD: Lead = {
  id: "CP1", company: "Klient Testowy", status: "new", email: "test@firma.pl",
  createdAt: 1, updatedAt: 1, notes: [],
} as Lead;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(ClientPanel, { leadId: "CP1", onClose: () => {} })); });
}
async function clickText(label: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent || "").includes(label));
  if (!btn) throw new Error("brak przycisku: " + label);
  await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

beforeEach(() => { store.setData((d) => { d.leads = [{ ...LEAD, notes: [] }]; d.sentMail = []; d.financeProjects = []; }); });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); });

describe("ClientPanel — sterowanie klientem z panelu", () => {
  it("renderuje nazwę firmy i następny krok", async () => {
    await mount();
    expect(container.textContent).toContain("Klient Testowy");
    expect(container.textContent).toMatch(/Pierwszy kontakt|Etap/);
  });

  it("klik etapu lejka zmienia status leada w store i dopisuje ślad w osi czasu", async () => {
    await mount();
    await clickText("Oferta");
    const l = store.data.leads.find((x) => x.id === "CP1")!;
    expect(l.status).toBe("offer");
    expect((l.notes || []).some((n) => /Etap zmieniony/.test(n.text))).toBe(true);
  });

  it("klik „za tydzień” ustawia nextFollowUpAt w przyszłości", async () => {
    await mount();
    await clickText("za tydzień");
    const l = store.data.leads.find((x) => x.id === "CP1")!;
    expect(typeof l.nextFollowUpAt).toBe("number");
    expect(l.nextFollowUpAt!).toBeGreaterThan(Date.now());
  });

  it("brak leada → czytelny panel zastępczy, nie pusty ekran", async () => {
    store.setData((d) => { d.leads = []; });
    await mount();
    expect(container.textContent).toMatch(/Nie udało się wczytać/i);
  });
});
