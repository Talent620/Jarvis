// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askJarvis } from "../src/lib/brain";
import { askCouncil } from "../src/lib/council";
import { PROVIDERS } from "../src/lib/providers/registry";
import type { AskCtx, ProviderImpl } from "../src/lib/providers/types";
import { store } from "../src/lib/store";
import { runTool } from "../src/lib/tools";
import { grantOutboundScope } from "../src/lib/permissions";
import { canRetainConversation, isMemoryToolBlocked } from "../src/lib/conversationPrivacy";

const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", cohere: "", openrouter: "", nvidia: "", github: "" };
const originalGemini = PROVIDERS.gemini.impl;
const originalGroq = PROVIDERS.groq.impl;
const originalOllama = PROVIDERS.ollama.impl;
const prompts: AskCtx[] = [];
const answer: ProviderImpl = async ctx => {
  prompts.push(ctx);
  return { text: ctx.system.includes("modułem pamięci długoterminowej") ? '{"facts":[{"key":"imie","value":"PrywatnySekret"}]}' : "Przemyślana odpowiedź na pytanie.", tools: [] };
};

beforeEach(() => {
  localStorage.clear();
  prompts.length = 0;
  store.setSettings({ provider: "gemini", model: "gemini-2.5-flash", keys: { ...noKeys, gemini: "test-key" },
    onDeviceOnly: false, proxyUrl: "", deepThink: false, interpreterMode: false, expertKnowledge: false,
    webSearch: false, councilMode: false, councilIncludeLocal: false, speculativeMode: false,
    confidenceGate: false, verifyHard: false, localRefine: false, localConsensus: false, adaptiveRouter: false,
    localFirstSimple: false, webllmEnabled: false, localEmbeddings: false, ollamaUrl: "",
    memoryServiceUrl: "http://127.0.0.1:8000", memoryServiceToken: "test-memory", activeProjectId: "",
    requireConsentAlways: false });
  store.setData(data => { data.memory = []; data.audit = []; data.world = { entities: [], relations: [] }; data.notes = []; });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
  PROVIDERS.gemini.impl = answer;
  PROVIDERS.groq.impl = answer;
  PROVIDERS.ollama.impl = answer;
  grantOutboundScope("*");
});

afterEach(() => {
  PROVIDERS.gemini.impl = originalGemini;
  PROVIDERS.groq.impl = originalGroq;
  PROVIDERS.ollama.impl = originalOllama;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectNoAutomaticMemory() {
  expect(store.data.memory).toEqual([]);
  expect(store.data.world).toEqual({ entities: [], relations: [] });
  expect(localStorage.getItem("jarvis.episodes.v1")).toBeNull();
  expect(localStorage.getItem("jarvis.corrections.v1")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(prompts.some(ctx => ctx.system.includes("modułem pamięci długoterminowej"))).toBe(false);
}

describe("temporary conversation retention", () => {
  it("answers a private chat without facts, episodes, corrections, world data or Mem0 requests", async () => {
    const result = await askJarvis([{ role: "user", content: "Mam na imię PrywatnySekret. Zawsze pisz do mnie krótko i zapamiętaj tę preferencję." }], undefined, undefined, undefined, undefined, { memoryPolicy: "private" });
    expect(result.text).toBeTruthy();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].memoryPolicy).toBe("private");
    expect(prompts[0].tools.some(tool => ["remember_fact", "forget_fact"].includes(tool.name))).toBe(false);
    expectNoAutomaticMemory();
  });

  it("keeps the speculative branch private too", async () => {
    store.setSettings({ speculativeMode: true, ollamaUrl: "http://127.0.0.1:11434" });
    const result = await askJarvis([{ role: "user", content: "Przeanalizuj strategię i porównaj warianty architektury. Mam na imię PrywatnySekret i zawsze preferuję prostotę." }], undefined, undefined, undefined, undefined, { memoryPolicy: "private" });
    expect(result.text).toBeTruthy();
    expect(prompts).toHaveLength(2);
    expect(prompts.every(ctx => ctx.memoryPolicy === "private")).toBe(true);
    expectNoAutomaticMemory();
  });

  it("retains normal conversations while a separate private request is pending", async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    PROVIDERS.gemini.impl = async ctx => {
      if (ctx.memoryPolicy === "private") await blocked;
      return answer(ctx);
    };
    const privateRequest = askJarvis([{ role: "user", content: "Sekret tylko na tę rozmowę" }], undefined, undefined, undefined, undefined, { memoryPolicy: "private" });
    await askJarvis([{ role: "user", content: "Mam na imię PrywatnySekret i pracuję w Poznaniu." }]);
    await vi.waitFor(() => expect(store.data.memory.some(fact => fact.value === "PrywatnySekret")).toBe(true));
    release();
    await privateRequest;
    const episodes = JSON.parse(localStorage.getItem("jarvis.episodes.v1") || "[]");
    expect(episodes).toHaveLength(1);
    expect(episodes[0].topic).not.toContain("Sekret tylko");
    const memoryPosts = vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).endsWith("/memories") && init?.method === "POST");
    expect(memoryPosts).toHaveLength(1);
    expect(String(memoryPosts[0][1]?.body)).not.toContain("Sekret tylko");
  });

  it("blocks memory tools per request without persisting their private arguments in audit", async () => {
    const secret = "sekret-w-narzędziu";
    const result = await runTool("remember_fact", { key: "sekret", value: secret }, { memoryPolicy: "private" });
    expect(result).toMatch(/prywatn/i);
    expect(store.data.memory).toHaveLength(0);
    expect(JSON.stringify(store.data.audit)).not.toContain(secret);
    expect(isMemoryToolBlocked("forget_fact", { memoryPolicy: "private" })).toBe(true);
    expect(isMemoryToolBlocked("add_note", { memoryPolicy: "private" })).toBe(false);
  });

  it("allows an explicitly requested note while redacting its private content in audit", async () => {
    const secret = "Treść jawnie zleconej prywatnej notatki";
    await runTool("add_note", { text: secret }, { memoryPolicy: "private" });
    expect(store.data.notes.some(note => note.text === secret)).toBe(true);
    expect(store.data.audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(store.data.audit)).not.toContain(secret);
  });

  it("passes privacy and cancellation to council without retrieving or modifying memory", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "test-key", groq: "test-groq" } });
    const controller = new AbortController();
    const result = await askCouncil([{ role: "user", content: "Wyjaśnij mój prywatny problem" }], { memoryPolicy: "private", signal: controller.signal });
    expect(result.text).toBeTruthy();
    expect(prompts).toHaveLength(3);
    expect(prompts.every(ctx => ctx.memoryPolicy === "private" && ctx.signal === controller.signal)).toBe(true);
    expectNoAutomaticMemory();
  });

  it("stops council before a judge runs, even if a member ignores AbortSignal", async () => {
    store.setSettings({ keys: { ...noKeys, gemini: "test-key", groq: "test-groq" } });
    const controller = new AbortController();
    PROVIDERS.gemini.impl = async ctx => { prompts.push(ctx); return new Promise(() => {}); };
    PROVIDERS.groq.impl = async ctx => { prompts.push(ctx); return new Promise(() => {}); };
    const pending = askCouncil([{ role: "user", content: "Zatrzymaj naradę" }], { memoryPolicy: "private", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(prompts).toHaveLength(2);
    expect(canRetainConversation({ signal: controller.signal })).toBe(false);
  });
});
