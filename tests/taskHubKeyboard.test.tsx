// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskHub from "../src/components/TaskHub";
import { store } from "../src/lib/store";

let host: HTMLDivElement;
let opener: HTMLButtonElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); opener = document.createElement("button");
  store.setData(data => { data.tasks = []; data.projects = []; });
  document.body.append(opener, host); opener.focus(); root = createRoot(host);
  // jsdom has no layout; these controls are visible in the real dialog.
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); opener.remove(); vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("personal task list keyboard access", () => {
  it("announces a dialog, focuses the input, and wraps Tab in both directions", async () => {
    await act(async () => root.render(<TaskHub onClose={() => {}} />));
    const dialog = host.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Moja lista");
    const first = dialog.querySelector<HTMLInputElement>('input[aria-label="Dodaj zadanie do mojej listy"]')!;
    const last = dialog.querySelector<HTMLButtonElement>(".panel-foot button")!;
    expect(document.activeElement).toBe(first);
    last.focus();
    await act(async () => { last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(first);
    await act(async () => { first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(last);
  });

  it("closes with Escape and restores focus to the original control on removal", async () => {
    const close = vi.fn();
    await act(async () => root.render(<TaskHub onClose={close} />));
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it("updates the visible list and counters after in-place additions and completion", async () => {
    await act(async () => root.render(<TaskHub onClose={() => {}} />));
    const originalTasks = store.data.tasks;
    await act(async () => {
      store.setData(data => data.tasks.unshift({ id: "visible-task", title: "Oddzwoń do klienta", done: false, priority: true, createdAt: Date.now() }));
    });
    expect(store.data.tasks).toBe(originalTasks);
    expect(host.textContent).toContain("Oddzwoń do klienta");
    expect(host.textContent).toContain("Priorytet (1)");
    const checkbox = host.querySelector<HTMLInputElement>('input[aria-label="Wykonane: Oddzwoń do klienta"]')!;
    await act(async () => checkbox.click());
    expect(store.data.tasks[0].done).toBe(true);
    expect(host.textContent).not.toContain("Oddzwoń do klienta");
    expect(host.textContent).not.toContain("Priorytet (1)");
    const completed = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "✓ Zrobione")!;
    await act(async () => completed.click());
    expect(host.textContent).toContain("Oddzwoń do klienta");
  });
});
