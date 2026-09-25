// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { letterFallback, markFallback, isLetterChar } from "../../src/lib/runtime/unicode";

type StoreMod = typeof import("../../src/lib/store");

async function freshStore(): Promise<StoreMod> {
  vi.resetModules();
  localStorage.clear();
  return import("../../src/lib/store");
}

const blob = () => localStorage.getItem("jarvis.data.v2");

describe("store: coalesced persistence", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("100 mutations in a burst serialize the blob once", async () => {
    const { store, PERSIST_DEBOUNCE_MS } = await freshStore();
    const before = store.persistCount;
    let wakes = 0;
    const off = store.subscribe(() => { wakes++; });
    for (let i = 0; i < 100; i++) store.setData((d) => { d.notes.unshift({ id: `n${i}`, text: "x", createdAt: i }); });
    expect(store.persistCount).toBe(before);
    expect(store.hasPendingWrites).toBe(true);
    expect(wakes).toBe(100); // in-memory state and subscribers stay synchronous
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 1);
    expect(store.persistCount).toBe(before + 1);
    expect(JSON.parse(blob()!).notes).toHaveLength(100);
    off();
    store.dispose();
  });

  it("continuous changes are still written within the max wait", async () => {
    const { store, PERSIST_MAX_WAIT_MS } = await freshStore();
    const before = store.persistCount;
    for (let t = 0; t < PERSIST_MAX_WAIT_MS + 200; t += 100) {
      store.setData((d) => { d.notes.unshift({ id: `n${t}`, text: "x", createdAt: t }); });
      vi.advanceTimersByTime(100);
    }
    expect(store.persistCount).toBeGreaterThan(before);
    store.dispose();
  });

  it("pagehide, hidden visibility and dispose flush synchronously", async () => {
    const { store } = await freshStore();
    store.setData((d) => { d.notes.unshift({ id: "a", text: "przed zamknięciem", createdAt: 1 }); });
    expect(blob()).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(blob()!).notes[0].id).toBe("a");

    store.setData((d) => { d.notes.unshift({ id: "b", text: "w tle", createdAt: 2 }); });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(JSON.parse(blob()!).notes[0].id).toBe("b");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });

    store.setData((d) => { d.notes.unshift({ id: "c", text: "dispose", createdAt: 3 }); });
    store.dispose();
    expect(JSON.parse(blob()!).notes[0].id).toBe("c");
    expect(store.hasPendingWrites).toBe(false);
  });

  it("explicit flush writes pending data and is a no-op when clean", async () => {
    const { store } = await freshStore();
    store.setData((d) => { d.tasks.unshift({ id: "t", title: "x", done: false }); });
    store.flush();
    const n = store.persistCount;
    store.flush();
    expect(store.persistCount).toBe(n);
    expect(JSON.parse(blob()!).tasks[0].id).toBe("t");
    store.dispose();
  });

  it("a storage event from another tab keeps both: their write and our unwritten changes", async () => {
    const { store } = await freshStore();
    store.setData((d) => { d.tasks.unshift({ id: "local", title: "mine", done: false }); });
    localStorage.setItem("jarvis.data.v2", JSON.stringify({ tasks: [{ id: "other", title: "theirs", done: false }] }));
    window.dispatchEvent(new StorageEvent("storage", { key: "jarvis.data.v2" }));
    expect(store.data.tasks.map((t) => t.id)).toEqual(["local", "other"]);
    // The merge is written at once, so the other tab reads both as well.
    expect(store.hasPendingWrites).toBe(false);
    expect(JSON.parse(blob()!).tasks.map((t: { id: string }) => t.id)).toEqual(["local", "other"]);
    store.dispose();
  });

  it("without local changes the other tab's data is adopted as is", async () => {
    const { store } = await freshStore();
    store.setData((d) => { d.tasks.unshift({ id: "old", title: "x", done: false }); });
    store.flush();
    localStorage.setItem("jarvis.data.v2", JSON.stringify({ tasks: [{ id: "other", title: "theirs", done: true }] }));
    window.dispatchEvent(new StorageEvent("storage", { key: "jarvis.data.v2" }));
    expect(store.data.tasks.map((t) => [t.id, t.done])).toEqual([["other", true]]);
    store.dispose();
  });

  it("a throwing replay does not lose the other tab's data", async () => {
    const { store } = await freshStore();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.setData((d) => { d.tasks[0].done = true; }); // throws on empty tasks: logged, skipped
    localStorage.setItem("jarvis.data.v2", JSON.stringify({ tasks: [] }));
    window.dispatchEvent(new StorageEvent("storage", { key: "jarvis.data.v2" }));
    err.mockRestore();
    expect(store.data.tasks).toEqual([]);
    store.dispose();
  });
});

describe("S9-safe unicode fallbacks", () => {
  it("fallback letter test agrees with \\p{L} on Polish, emoji, digits and punctuation", () => {
    for (const ch of Array.from("aąćęłńóśźżĄĆĘŁŃÓŚŹŻxyzΩжé")) expect(letterFallback(ch)).toBe(true);
    for (const ch of ["1", "@", "!", " ", "🔥", "-", "́"]) expect(letterFallback(ch)).toBe(false);
    for (const ch of ["中", "あ", "한", "ب", "א"]) expect(letterFallback(ch)).toBe(isLetterChar(ch));
  });

  it("fallback mark test covers combining accents", () => {
    expect(markFallback("́")).toBe(true);
    expect(markFallback("̨")).toBe(true);
    expect(markFallback("a")).toBe(false);
  });
});
