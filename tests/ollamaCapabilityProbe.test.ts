import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedOllamaCapabilities, clearOllamaCapabilityCache, probeOllamaTools } from "../src/lib/providers/ollama";

const base = "http://127.0.0.1:11435";
const model = "opaque-custom:latest";
beforeEach(clearOllamaCapabilityCache);
afterEach(() => vi.unstubAllGlobals());

function service(reply: "tool" | "greeting" = "tool") {
  return vi.fn(async (url: string, init?: RequestInit) => {
    expect(url.startsWith(base)).toBe(true);
    if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: model }] });
    if (url.endsWith("/api/ps")) return Response.json({ models: [] });
    if (url.endsWith("/api/show")) return Response.json({ capabilities: ["tools"] });
    expect(url.endsWith("/api/chat")).toBe(true);
    const request = JSON.parse(String(init?.body));
    expect(request.tools).toHaveLength(1);
    expect(request.messages).toHaveLength(1);
    expect(request.options.num_predict).toBe(128);
    const value = JSON.parse(request.messages[0].content.match(/with value ("[^"]+")/)[1]);
    return Response.json({ message: reply === "tool" ? { tool_calls: [{ function: { name: "jarvis_capability_echo", arguments: { value } } }] } : { content: "Cześć! Jestem gotowy." } });
  });
}

describe("Ollama: functional protocol evidence, controlled provider", () => {
  it("distinguishes installed, loaded and actually emitted tool call without interpreting model name", async () => {
    vi.stubGlobal("fetch", service());
    const result = await probeOllamaTools(base, model);
    expect(result).toMatchObject({ installed: true, loadedBeforeProbe: false, tools: "passed", advertised: ["tools"] });
    expect(result.reason).toContain("nie jest to test całego agenta");
  });
  it("a greeting and tools metadata do not pass the functional probe", async () => {
    vi.stubGlobal("fetch", service("greeting"));
    expect((await probeOllamaTools(base, model)).tools).toBe("failed");
  });
  it("caches success with TTL, separates endpoints and rechecks after expiry", async () => {
    let now = 100;
    const fetch = service(); vi.stubGlobal("fetch", fetch);
    await probeOllamaTools(base, model, { now: () => now });
    await probeOllamaTools(base, model, { now: () => now });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(cachedOllamaCapabilities("http://127.0.0.1:11434", model, now)).toBeNull();
    now += 600001;
    await probeOllamaTools(base, model, { now: () => now });
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it("missing model never triggers generation or download", async () => {
    const fetch = vi.fn(async () => Response.json({ models: [] })); vi.stubGlobal("fetch", fetch);
    expect(await probeOllamaTools(base, model)).toMatchObject({ installed: false, loadedBeforeProbe: null, tools: "unknown" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("STOP aborts without creating negative capability evidence", async () => {
    const controller = new AbortController(); controller.abort();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(probeOllamaTools(base, model, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    expect(cachedOllamaCapabilities(base, model)).toBeNull();
  });
  it("unavailable inventory remains unknown, not installed or capability failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await probeOllamaTools(base, model)).toMatchObject({ installed: null, loadedBeforeProbe: null, tools: "unknown" });
  });
});
