// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { parseLocalToolCommand } from "../src/lib/localToolCommands";
import { askJarvis } from "../src/lib/brain";
import { store } from "../src/lib/store";
afterEach(() => vi.unstubAllGlobals());
it("przekazuje jawne polecenie do istniejącego narzędzia bez modelu", async () => {
  const title = "Sprawdź żółć i nową linię";
  const before = store.data.tasks.length;
  const network = vi.fn(() => { throw Error("Model must not be called"); });
  vi.stubGlobal("fetch", network);
  const result = await askJarvis([{ role: "user", content: `Dodaj zadanie: ${title}` }]);
  expect(result.tools).toEqual(["add_task"]);
  expect(store.data.tasks.length).toBe(before + 1);
  expect(store.data.tasks[0]?.title).toBe(title);
  expect(store.data.audit[0]).toMatchObject({ tool: 'add_task', status: 'ok' });
  expect(JSON.parse(store.data.audit[0].input as string).title).toBe(title);
  expect(network).not.toHaveBeenCalled();
});
it("nie tworzy danych po wcześniejszym STOP", async () => {
  const before = store.data.tasks.length;
  const controller = new AbortController(); controller.abort();
  await expect(askJarvis([{ role: 'user', content: 'Dodaj zadanie: Niedozwolony zapis po STOP' }], undefined, undefined, undefined, undefined, controller.signal)).rejects.toThrow();
  expect(store.data.tasks.length).toBe(before);
});
it("nie przechwytuje niejawnych lub niejednoznacznych próśb", () => {
  expect(parseLocalToolCommand("Jak dodać zadanie: przykład")).toBeNull();
  expect(parseLocalToolCommand("Dodaj zadanie: ")).toBeNull();
  expect(parseLocalToolCommand("Dodaj notatkę: Żółć")).toEqual({ name: "add_note", input: { text: "Żółć" } });
});
