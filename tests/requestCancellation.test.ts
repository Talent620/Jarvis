// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askJarvis, STALL_HARD_MS } from "../src/lib/brain";
import { cancelGeneration, generationSignal, resetGeneration, startGeneration } from "../src/lib/generation";
import { registerTool, runTool, toolDefs, unregisterTool } from "../src/lib/tools";
import { setConsentHandler, resetConsents, clearOutboundScope, setAutoConsent } from "../src/lib/permissions";
import { store } from "../src/lib/store";
import { askGemini } from "../src/lib/providers/gemini";
import { askAnthropic } from "../src/lib/providers/anthropic";
import { makeOpenAICompatible } from "../src/lib/providers/openai";
import { askOllamaNative } from "../src/lib/providers/ollama";
import { fetchTimeout } from "../src/lib/http";
import type { AskCtx, JarvisReply } from "../src/lib/providers/types";

const previous = { ...store.settings, keys: { ...store.settings.keys } };
const emptyKeys = Object.fromEntries(Object.keys(store.settings.keys).map((key) => [key, ""]));
const history = [{ role: "user" as const, content: "Dodaj zadanie testowe" }];
const geminiTool = (title: string) => Response.json({ candidates: [{ content: { parts: [{ functionCall: { name: "add_task", args: { title } } }] } }] });
const openaiTool = (title: string) => Response.json({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "task-call", type: "function", function: { name: "add_task", arguments: JSON.stringify({ title }) } }] } }] });
const openaiAnswer = () => Response.json({ choices: [{ message: { role: "assistant", content: "Wynik testowy" } }] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  resetGeneration(); resetConsents(); clearOutboundScope(); setAutoConsent(false); setConsentHandler(null);
  store.setData((data) => { data.tasks = []; data.memory = []; data.audit = []; });
  store.setSettings({
    ...previous, provider: "gemini", model: "gemini-2.5-flash", keys: { ...emptyKeys, gemini: "gemini-test-key", groq: "groq-test-key" },
    proxyUrl: "", ollamaUrl: "", onDeviceOnly: false, webllmEnabled: false,
    deepThink: false, verifyHard: false, councilMode: false, speculativeMode: false,
    localRefine: false, localConsensus: false, confidenceGate: false, webSearch: false,
    memoryServiceUrl: "", localEmbeddings: false, freeMode: false,
  });
});
afterEach(() => {
  resetGeneration(); setConsentHandler(null); unregisterTool("cancel_test_outbound");
  vi.unstubAllGlobals(); vi.useRealTimers(); store.setSettings(previous);
});

describe("request-scoped cancellation and side effects", () => {
  it("STOP rejects the request and a late model tool call cannot execute", async () => {
    const late = deferred<Response>();
    const fetcher = vi.fn(() => late.promise); // Simulate a transport that ignores AbortSignal.
    vi.stubGlobal("fetch", fetcher);
    const token = startGeneration();
    const signal = generationSignal(token);
    const pending = askJarvis(history, undefined, undefined, undefined, undefined, { signal, memoryPolicy: "private" });
    const stopped = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    cancelGeneration();
    await stopped;
    late.resolve(geminiTool("spóźniona akcja"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signal.aborted).toBe(true);
    expect(store.data.tasks).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("watchdog closes the losing provider; fallback executes once and late tools execute zero times", async () => {
    vi.useFakeTimers();
    const late = deferred<Response>();
    let fallbackCalls = 0;
    const fetcher = vi.fn((url: string) => {
      if (url.includes("generativelanguage")) return late.promise;
      fallbackCalls += 1;
      return Promise.resolve(fallbackCalls === 1 ? openaiTool("jedyna akcja zapasowa") : openaiAnswer());
    });
    vi.stubGlobal("fetch", fetcher);
    const pending = askJarvis(history, undefined, undefined, undefined, undefined, { memoryPolicy: "private" });
    await vi.advanceTimersByTimeAsync(STALL_HARD_MS + 1);
    await expect(pending).resolves.toMatchObject({ via: "groq", fellBack: true });
    expect(store.data.tasks.map((task) => task.title)).toEqual(["jedyna akcja zapasowa"]);

    late.resolve(geminiTool("spóźniona akcja główna"));
    await vi.advanceTimersByTimeAsync(1);
    expect(store.data.tasks.map((task) => task.title)).toEqual(["jedyna akcja zapasowa"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fallbackCalls).toBe(2);
  });

  it("does not retry or fail over after a tool ran and the follow-up model request loses its connection", async () => {
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length === 1) return geminiTool("wykonane przed awarią");
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(askJarvis(history, undefined, undefined, undefined, undefined, { memoryPolicy: "private" })).rejects.toThrow("Nie ponawiam ich automatycznie");
    expect(store.data.tasks.map((task) => task.title)).toEqual(["wykonane przed awarią"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not execute after consent arrives for an already cancelled request", async () => {
    const execute = vi.fn(async () => "wykonano");
    registerTool({ name: "cancel_test_outbound", description: "test", input_schema: { type: "object", properties: {} } }, execute);
    const consent = deferred<{ allow: boolean; remember: boolean }>();
    setConsentHandler(() => consent.promise);
    const controller = new AbortController();
    const pending = runTool("cancel_test_outbound", {}, { signal: controller.signal });
    const stopped = expect(pending).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();
    await stopped;
    consent.resolve({ allow: true, remember: true });
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    expect(localStorage.getItem("jarvis.consents.v1")).not.toContain("cancel_test_outbound");
  });

  it("keeps unrelated background tools usable after chat STOP", async () => {
    const old = startGeneration();
    const oldSignal = generationSignal(old);
    cancelGeneration();
    await expect(runTool("add_task", { title: "niezależne zadanie w tle" })).resolves.toBeTruthy();
    expect(oldSignal.aborted).toBe(true);
    expect(store.data.tasks.map((task) => task.title)).toEqual(["niezależne zadanie w tle"]);
  });

  it("does not execute a tool invented by a model when this request exposes no tools", async () => {
    const fetcher = vi.fn(async () => fetcher.mock.calls.length === 1
      ? geminiTool("niedozwolona akcja")
      : Response.json({ candidates: [{ content: { parts: [{ text: "Nie wykonano działania." }] } }] }));
    vi.stubGlobal("fetch", fetcher);
    await askGemini({ apiKey: "test", model: "test", system: "Tylko analiza", history, tools: [], webSearch: false });
    expect(store.data.tasks).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("every network adapter checks its tool execution scope", () => {
  const variants: { name: string; run: (ctx: AskCtx) => Promise<JarvisReply>; response: () => Response }[] = [
    { name: "Gemini", run: askGemini, response: () => geminiTool("late") },
    { name: "Anthropic", run: askAnthropic, response: () => Response.json({ content: [{ type: "tool_use", id: "1", name: "add_task", input: { title: "late" } }], stop_reason: "tool_use" }) },
    { name: "OpenAI-compatible", run: makeOpenAICompatible("https://provider.example/chat"), response: () => openaiTool("late") },
    { name: "Ollama", run: (ctx) => askOllamaNative(ctx, { base: "http://localhost:11434", think: false, options: {} }), response: () => Response.json({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "add_task", arguments: { title: "late" } } }] } }) },
  ];
  it.each(variants)("$name ignores late tool calls after abort", async ({ run, response }) => {
    const late = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => late.promise));
    const controller = new AbortController();
    const pending = run({
      apiKey: "test", model: "test", system: "test", history, webSearch: false,
      tools: toolDefs.filter((tool) => tool.name === "add_task"), signal: controller.signal,
    });
    const stopped = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    late.resolve(response());
    await stopped;
    expect(store.data.tasks).toHaveLength(0);
  });
});

describe("HTTP cancellation", () => {
  it("forwards caller abort instead of replacing it with the timeout controller", async () => {
    const controller = new AbortController();
    let sentSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
      sentSignal = options.signal;
      return new Promise<Response>((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    }));
    const pending = fetchTimeout("https://provider.example", { signal: controller.signal }, 100_000);
    const stopped = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await stopped;
    expect(sentSignal?.aborted).toBe(true);
  });
});
