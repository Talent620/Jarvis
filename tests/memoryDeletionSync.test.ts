// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../src/lib/store";
import { deleteFact, memoryBlock, prepareMemoryContext, rememberFact } from "../src/lib/memory";
import { pullSync, pushSync } from "../src/lib/sync";
import { applyParsed, buildNormalPayload } from "../src/lib/backup";

const fact = (id: string) => ({ id, key: "miasto", value: "Prywatny tekst", createdAt: 1 });
function remote(data: Record<string, unknown>) {
  const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) => new Response(JSON.stringify({ data }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(() => {
  store.setSettings({ syncUrl: "https://sync.example", syncToken: "test", onDeviceOnly: true });
  store.setData(data => { data.memoryDeletedIds = []; data.memory = []; data.tasks = []; data.notes = []; });
});
afterEach(() => vi.unstubAllGlobals());

describe("forgotten fact IDs across sync and backups", () => {
  it("does not revive a locally deleted fact when pulling an older snapshot", async () => {
    store.setData(data => { data.memory = [fact("forgotten"), fact("kept")]; });
    deleteFact("forgotten");
    remote({ memory: [fact("forgotten")] });
    expect(await pullSync()).toContain("scalone");
    expect(store.data.memory.map(item => item.id)).toEqual(["kept"]);
    expect(store.data.memoryDeletedIds).toEqual(["forgotten"]);
    expect(JSON.parse(localStorage.getItem("jarvis.data.v2") || "{}").memoryDeletedIds).toEqual(["forgotten"]);
  });

  it("unions deletions from both devices and affects only memory", async () => {
    store.setData(data => {
      data.memory = [fact("local-deletion"), fact("remote-deletion"), fact("kept")];
      data.tasks = [{ id: "remote-deletion", title: "Niezależne zadanie", done: false, createdAt: 1 }];
    });
    deleteFact("local-deletion");
    remote({ memoryDeletedIds: ["remote-deletion", "remote-deletion"], memory: [fact("local-deletion"), fact("remote-deletion")] });
    await pullSync();
    expect(new Set(store.data.memoryDeletedIds)).toEqual(new Set(["local-deletion", "remote-deletion"]));
    expect(store.data.memory.map(item => item.id)).toEqual(["kept"]);
    expect(store.data.tasks[0].title).toBe("Niezależne zadanie");
  });

  it("accepts remote deletion metadata even without a memory collection", async () => {
    store.setData(data => { data.memory = [fact("removed-remotely")]; });
    remote({ memoryDeletedIds: ["removed-remotely"] });
    await pullSync();
    expect(store.data.memory).toEqual([]);
  });

  it("exports deletion IDs in sync payload without the deleted content", async () => {
    store.setData(data => { data.memory = [fact("deleted")]; });
    deleteFact("deleted");
    const fetcher = remote({});
    await pushSync();
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.data.memoryDeletedIds).toEqual(["deleted"]);
    expect(body.data.memory).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Prywatny tekst");
  });

  it("allows intentionally adding the same fact again with a new ID", async () => {
    rememberFact("miasto", "Kraków");
    const oldId = store.data.memory[0].id;
    deleteFact(oldId);
    rememberFact("miasto", "Warszawa");
    const newId = store.data.memory[0].id;
    expect(newId).not.toBe(oldId);
    remote({ memory: [{ ...fact(oldId), value: "Kraków" }] });
    await pullSync();
    expect(store.data.memory).toHaveLength(1);
    expect(store.data.memory[0]).toMatchObject({ id: newId, value: "Warszawa" });
  });

  it("preserves deletion metadata across export and importing older backups", () => {
    store.setData(data => { data.memory = [fact("deleted")]; });
    deleteFact("deleted");
    const exported = buildNormalPayload();
    expect((exported.data as Record<string, unknown>).memoryDeletedIds).toEqual(["deleted"]);
    expect(applyParsed({ app: "jarvis", data: { memory: [fact("deleted"), fact("legacy-kept")] } })).toContain("przywrócone");
    expect(store.data.memory.map(item => item.id)).toEqual(["legacy-kept"]);
    expect(store.data.memoryDeletedIds).toEqual(["deleted"]);
    applyParsed({ app: "jarvis", data: { memoryDeletedIds: ["legacy-kept"], memory: [fact("deleted"), fact("legacy-kept")] } });
    expect(store.data.memory).toEqual([]);
    expect(new Set(store.data.memoryDeletedIds)).toEqual(new Set(["deleted", "legacy-kept"]));
  });

  it("ignores malformed deletion metadata without discarding valid facts", async () => {
    store.setData(data => { data.memory = [fact("kept"), fact("deleted")]; });
    deleteFact("deleted");
    remote({ memoryDeletedIds: [null, false, {}, "", "deleted"], memory: [fact("deleted")] });
    await pullSync();
    expect(store.data.memoryDeletedIds).toEqual(["deleted"]);
    expect(store.data.memory.map(item => item.id)).toEqual(["kept"]);
  });

  it("imports valid facts from a malformed backup without poisoning persisted memory", () => {
    const kept = { ...fact("kept"), pinned: true };
    expect(() => applyParsed({ app: "jarvis", data: {
      memoryDeletedIds: ["deleted"],
      memory: [null, false, "tekst", [], {}, { id: 7 }, fact("deleted"), kept],
    } })).not.toThrow();
    expect(store.data.memory).toEqual([kept]);
    expect(JSON.parse(localStorage.getItem("jarvis.data.v2") || "{}").memory).toEqual([kept]);
    expect(store.data.memoryDeletedIds).toEqual(["deleted"]);
  });

  it("removes a forgotten fact from already prepared prompt memory", async () => {
    store.setData(data => { data.memory = [fact("cached")]; });
    await prepareMemoryContext("miasto");
    expect(memoryBlock()).toContain("Prywatny tekst");
    deleteFact("cached");
    expect(memoryBlock()).not.toContain("Prywatny tekst");
  });
});
