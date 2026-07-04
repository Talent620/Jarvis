// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { store, uid } from "../src/lib/store";

beforeEach(() => {
  store.setData((d) => {
    d.journal = [];
  });
});

const entry = (over: Partial<import("../src/types").JournalEntry>) => ({
  id: uid(),
  title: "",
  body: "",
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
});

describe("dziennik — selektywne udostępnianie czatowi", () => {
  it("wpisy są domyślnie prywatne (czat ich nie widzi)", () => {
    store.setData((d) => d.journal.unshift(entry({ title: "prywatne", body: "tajne" })));
    expect(store.data.journal.filter((j) => j.shared)).toHaveLength(0);
  });

  it("do kontekstu czatu trafiają wyłącznie wpisy oznaczone jako shared", () => {
    store.setData((d) => {
      d.journal.unshift(entry({ title: "prywatny", body: "a" }));
      d.journal.unshift(entry({ title: "jawny", body: "b", shared: true }));
    });
    const shared = store.data.journal.filter((j) => j.shared);
    expect(shared.map((j) => j.title)).toEqual(["jawny"]);
  });
});
