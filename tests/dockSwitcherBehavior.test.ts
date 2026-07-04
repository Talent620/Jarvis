// @vitest-environment jsdom
// === Test ZACHOWANIA przełącznika dokowania okna ===
// Montujemy DockSwitcher, klikamy „prawo"/„lewo"/„środek" i sprawdzamy, że GLOBALNE ustawienie
// panelDock realnie się zmienia (to ono, przez klasę body, przesuwa wszystkie panele w bok).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import DockSwitcher from "../src/components/DockSwitcher";
import { store } from "../src/lib/store";
import { dockBodyClass, normalizeDock } from "../src/lib/panelDock";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(DockSwitcher)); });
}
async function clickIcon(icon: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent || "").includes(icon));
  if (!btn) throw new Error("brak przycisku dokowania: " + icon);
  await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

beforeEach(() => { store.setSettings({ panelDock: "center" }); });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); });

describe("DockSwitcher — dokowanie okna zmienia ustawienie", () => {
  it("klik ➡ ustawia panelDock=right; ⬅ = left; ⬜ = center", async () => {
    await mount();
    await clickIcon("➡");
    expect(store.settings.panelDock).toBe("right");
    await clickIcon("⬅");
    expect(store.settings.panelDock).toBe("left");
    await clickIcon("⬜");
    expect(store.settings.panelDock).toBe("center");
  });

  it("aktywna opcja jest podświetlona (aria-pressed) i mapuje się na klasę body", async () => {
    store.setSettings({ panelDock: "right" });
    await mount();
    const pressed = Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed?.textContent).toContain("➡");
    expect(dockBodyClass(normalizeDock(store.settings.panelDock))).toBe("dock-right");
  });
});
