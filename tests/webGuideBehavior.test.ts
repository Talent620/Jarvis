// @vitest-environment jsdom
// === Test ZACHOWANIA przewodnika: rozmowa dochodzi do budowy i oddaje brief/typ/styl ===
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WebGuide from "../src/components/WebGuide";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

async function mount(onComplete: (b: unknown, k: unknown, s: unknown) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(WebGuide, { onComplete, onCancel: () => {} })); });
}
function ta() { return container.querySelector("textarea") as HTMLTextAreaElement; }
async function type(v: string) {
  const el = ta();
  await act(async () => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function clickBtn(text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent || "").includes(text));
  if (!btn) throw new Error("brak przycisku: " + text);
  await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

beforeEach(() => {});
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); });

describe("WebGuide — rozmowa krok po kroku", () => {
  it("pokazuje pierwsze pytanie i radę", async () => {
    await mount(() => {});
    expect(container.textContent).toContain("jak nazywa się firma");
    expect(container.textContent).toContain("💡");
  });

  it("przejście przez tor: business→…→done → „Zbuduj” oddaje brief z firmą + typ + styl", async () => {
    const onComplete = vi.fn();
    await mount(onComplete);
    // business (tekst) → Dalej
    await type("Stolarnia Dąb"); await clickBtn("Dalej");
    // industry (tekst) → Dalej
    await type("stolarnia schodów na wymiar"); await clickBtn("Dalej");
    // goal (chip) — klik gotowego celu
    await clickBtn("Pozyskać klientów");
    // audience → Pomiń (opcjonalny)
    await clickBtn("Pomiń");
    // kind (chip — pierwsza rekomendacja) → dowolny chip typu
    await clickBtn("Landing");
    // style (chip) — klik rekomendowanego (Luxury dla stolarni)
    await clickBtn("Luxury");
    // sections — użyj proponowanych
    await clickBtn("Użyj proponowanych");
    // contact → Pomiń
    await clickBtn("Pomiń");
    // done → Zbuduj
    expect(container.textContent).toContain("Zbudować stronę");
    await clickBtn("Zbuduj stronę");

    expect(onComplete).toHaveBeenCalledTimes(1);
    const [brief, kind, style] = onComplete.mock.calls[0];
    expect((brief as { business?: string }).business).toBe("Stolarnia Dąb");
    expect(kind).toBe("landing");
    expect(style).toBe("luxury");
  });
});
