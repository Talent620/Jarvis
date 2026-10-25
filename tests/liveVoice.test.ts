import { describe, it, expect } from "vitest";
import { closeReason, liveFunctionResponse, liveNonBlocking, liveToolDeclarations, LIVE_MODEL_STABLE, LIVE_MODEL_NATIVE } from "../src/lib/liveVoice";

describe("liveToolDeclarations (bezpieczny podzbiór narzędzi w głosie)", () => {
  const defs = [
    { name: "list_tasks", description: "Lista zadań", input_schema: { type: "object", properties: {} } },
    { name: "add_task", description: "Dodaj zadanie", input_schema: { type: "object", properties: { text: {} } } },
    { name: "gmail_send", description: "Wyślij maila", input_schema: { type: "object", properties: {} } },
    { name: "mcp_gcal_addevent", description: "MCP dodaj event", input_schema: { type: "object", properties: {} } },
  ];
  const risk = (n: string): "read" | "write" | "outbound" =>
    n === "list_tasks" ? "read" : n === "add_task" ? "write" : n === "gmail_send" ? "outbound" : "write";

  it("wystawia read + write i mapuje input_schema → parameters", () => {
    const out = liveToolDeclarations(defs, risk);
    const names = out.map((d) => d.name);
    expect(names).toContain("list_tasks");
    expect(names).toContain("add_task");
    expect(out.find((d) => d.name === "add_task")?.parameters).toEqual({ type: "object", properties: { text: {} } });
  });

  it("POMIJA outbound (np. gmail_send) — brak bramki zgody w trybie live", () => {
    expect(liveToolDeclarations(defs, risk).map((d) => d.name)).not.toContain("gmail_send");
  });

  it("przepuszcza narzędzia MCP nawet bez znanego ryzyka", () => {
    expect(liveToolDeclarations(defs, risk).map((d) => d.name)).toContain("mcp_gcal_addevent");
  });

  it("allowOutbound=true wystawia także outbound (pełny dostęp + potwierdzenie głosem)", () => {
    const names = liveToolDeclarations(defs, risk, true).map((d) => d.name);
    expect(names).toContain("gmail_send");
    expect(names).toContain("list_tasks");
    expect(names).toContain("add_task");
  });
});

describe("closeReason (diagnostyka rozmowy na żywo)", () => {
  it("rozpoznaje przekroczony limit", () => {
    expect(closeReason(1011, "Resource has been exhausted")).toMatch(/limit/i);
    expect(closeReason(1008, "quota exceeded")).toMatch(/limit/i);
  });
  it("rozpoznaje problem z kluczem", () => {
    expect(closeReason(1008, "API key invalid")).toMatch(/klucz/i);
    expect(closeReason(1008, "permission denied")).toMatch(/klucz/i);
  });
  it("rozpoznaje błąd serwera (kod 1011)", () => {
    expect(closeReason(1011, "")).toMatch(/serwer/i);
  });
  it("rozpoznaje zerwanie sieci (kod 1006)", () => {
    expect(closeReason(1006, "")).toMatch(/sieć|internet/i);
  });
  it("zwraca surową treść, gdy nic nie pasuje", () => {
    expect(closeReason(1000, "do widzenia")).toBe("do widzenia");
  });
  it("zwraca undefined przy braku treści i normalnym kodzie", () => {
    expect(closeReason(1000, "")).toBeUndefined();
  });
});

describe("Live model from the catalog (M5)", () => {
  it("the stable model is the catalog default, never the dead 2.0 id", () => {
    expect(LIVE_MODEL_STABLE).toBe("models/gemini-3.8-live");
    expect(LIVE_MODEL_STABLE).not.toContain("gemini-2.0-flash-live-001");
    expect(LIVE_MODEL_NATIVE).toBe("models/gemini-2.5-flash-preview-native-audio-dialog");
  });

  it("the default model calls functions without blocking; results come back when idle", () => {
    expect(liveNonBlocking(LIVE_MODEL_STABLE)).toBe(true);
    expect(liveNonBlocking(LIVE_MODEL_NATIVE)).toBe(false);
    const decl = liveToolDeclarations([{ name: "get_weather", description: "x", input_schema: {} }], () => "read", false, true);
    expect(decl[0].behavior).toBe("NON_BLOCKING");
    expect(liveFunctionResponse({ id: "1", name: "get_weather" }, "18 stopni", true)).toEqual({ id: "1", name: "get_weather", response: { result: "18 stopni", scheduling: "WHEN_IDLE" } });
    expect(liveFunctionResponse({ id: "1", name: "get_weather" }, "18 stopni", false)).toEqual({ id: "1", name: "get_weather", response: { result: "18 stopni" } });
  });
});
