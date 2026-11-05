import { afterEach, describe, expect, it, vi } from "vitest";
import { askOllamaNative, fitOllamaHistory } from "../src/lib/providers/ollama";
import { isToolFreeGreeting } from "../src/lib/toolSelector";

afterEach(() => vi.unstubAllGlobals());

describe("Ollama — budżet kontekstu", () => {
  it("pozostawia instrukcję i ostatnią turę, usuwa najstarsze tury z dużej historii", () => {
    const history = [
      { role: "system" as const, content: "Instrukcja" },
      { role: "user" as const, content: "stara ".repeat(1500) },
      { role: "assistant" as const, content: "stara odpowiedź" },
      { role: "user" as const, content: "bieżące polecenie" },
      { role: "assistant" as const, content: "", tool_calls: [{ function: { name: "x", arguments: {} } }] },
      { role: "tool" as const, content: "wynik", tool_name: "x" },
    ];
    const result = fitOllamaHistory(history, [], 4096);
    expect(result.map(m => m.content)).toEqual(["Instrukcja", "bieżące polecenie", "", "wynik"]);
    expect(history).toHaveLength(6);
  });
  it("nie ucina bieżącej prośby ani schematów, gdy same przekraczają budżet", () => {
    const history = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "x".repeat(10000) }];
    expect(fitOllamaHistory(history, [{ schema: "x".repeat(5000) }], 1024)).toEqual(history);
  });
  it("adapter wysyła dopasowaną historię i pozostawia wybrany model i narzędzia", async () => {
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("qwen3:4b");
      expect(body.messages.map((m: { content: string }) => m.content)).toEqual(["instrukcja", "nowe"]);
      expect(body.tools[0].function.name).toBe("calculate");
      return new Response(JSON.stringify({ message: { role: "assistant", content: "OK" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await askOllamaNative({ apiKey: "local", model: "qwen3:4b", system: "instrukcja", webSearch: false,
      history: [{ role: "user", content: "stare ".repeat(3000) }, { role: "assistant", content: "odpowiedź" }, { role: "user", content: "nowe" }],
      tools: [{ name: "calculate", description: "licz", input_schema: { type: "object", properties: {} } }],
    }, { base: "http://localhost:11434", think: false, options: { num_ctx: 4096 } });
    expect(result.text).toBe("OK");
  });
  it("raportuje rzeczywisty błąd przepełnienia z Ollamy zamiast udawać odpowiedź", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "context length exceeded" }), { status: 400 })));
    await expect(askOllamaNative({ apiKey: "local", model: "local", system: "sys", webSearch: false,
      history: [{ role: "user", content: "test" }], tools: [] },
    { base: "http://localhost:11434", think: false, options: { num_ctx: 4096 } }))
      .rejects.toThrow(/Ollama odrzuciła zapytanie: przekroczono kontekst modelu/);
  });
  it("rozpoznaje tylko jednoznaczne powitania, a nie prośby o wykonanie akcji", () => {
    expect(isToolFreeGreeting("Cześć JARVIS, przedstaw swoje możliwości.")).toBe(true);
    expect(isToolFreeGreeting("Dzień dobry!")).toBe(true);
    expect(isToolFreeGreeting("Cześć Jarvis, otwórz przeglądarkę")).toBe(false);
    expect(isToolFreeGreeting("Jaka jest pogoda?")).toBe(false);
  });
});
