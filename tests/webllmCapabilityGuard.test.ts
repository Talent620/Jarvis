import { expect, it } from "vitest";
import { askWebllm } from "../src/lib/providers/webllm";
const base = { apiKey: "local", model: "fixture", system: "test", tools: [], history: [], webSearch: false };
it("WebLLM nie udaje wykonania czynności narzędziowej", async () => {
  await expect(askWebllm({ ...base, requiresTools: true })).rejects.toThrow(/Nie wykonano działania/);
});
it("WebLLM nie ignoruje po cichu dołączonego obrazu", async () => {
  await expect(askWebllm({ ...base, history: [{ role: "user", content: "ekran", image: { data: "fixture", mediaType: "image/png" } }] })).rejects.toThrow(/Nie przeprowadzono analizy/);
});
