// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useStore, useStoreSelector, shallowEqual } from "../../src/hooks/useStore";
import { store } from "../../src/lib/store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("root subscription (M1 performance)", () => {
  it("App no longer subscribes to every store change", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).not.toMatch(/\buseStore\(\)/);
    expect(app).toMatch(/useStoreSelector\(\(\) => store\.settings\)/);
  });

  it("data mutations re-render a useStore() consumer every time, the selector-based root not at all", async () => {
    let fullRenders = 0;
    let rootRenders = 0;
    function Full() {
      useStore();
      fullRenders++;
      return null;
    }
    function Root() {
      useStoreSelector(() => store.settings);
      useStoreSelector(() => ({ tasksToday: store.data.tasks.filter((t) => !t.done).length }), shallowEqual);
      rootRenders++;
      return null;
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => { root.render(createElement("div", null, createElement(Full), createElement(Root))); });
    fullRenders = 0;
    rootRenders = 0;
    for (let i = 0; i < 100; i++) {
      await act(async () => { store.setData((d) => { d.notes.unshift({ id: `n${i}`, text: "x", createdAt: i }); }); });
    }
    expect(fullRenders).toBe(100);
    expect(rootRenders).toBe(0);
    // A change the root actually renders still re-renders it.
    await act(async () => { store.setData((d) => { d.tasks.unshift({ id: "t", title: "nowe", done: false }); }); });
    expect(rootRenders).toBe(1);
    await act(async () => { store.setSettings({ theme: "default" }); });
    expect(rootRenders).toBe(2);
    await act(async () => { root.unmount(); });
    store.dispose();
  });
});
