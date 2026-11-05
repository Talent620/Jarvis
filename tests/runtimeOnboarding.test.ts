// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapDesktopRuntime } from "../src/lib/runtimeOnboarding";
import { store } from "../src/lib/store";
import type { RuntimeProfile, RuntimeReadiness, RuntimeStatus } from "../src/lib/localRuntimeClient";

const previous = { ...store.settings, keys: { ...store.settings.keys } };
const emptyKeys = Object.fromEntries(Object.keys(store.settings.keys).map((key) => [key, ""]));
const connection = { url: "http://127.0.0.1:3211", token: "local-runtime-test-token" };
const model = "qwen2.5:1.5b";
const readiness = (state: RuntimeReadiness["state"] = "SETUP"): RuntimeReadiness => ({
  state, checkedAt: state === "READY" ? new Date(Date.now()).toISOString() : null,
  expiresAt: state === "READY" ? new Date(Date.now() + 60_000).toISOString() : null,
  reason: state === "READY" ? "Model odpowiedział." : "Trwa test modelu.",
});
const profile = (patch: Partial<RuntimeProfile["active"]> = {}): RuntimeProfile => {
  const active = { version: 1, policy: "local", ollamaUrl: "http://127.0.0.1:11434", model, ...patch };
  return { active, requested: active, readiness: readiness() };
};
const status = (state: RuntimeReadiness["state"] = "SETUP"): RuntimeStatus => ({
  name: "jarvis-runtime", version: "1", serverId: "test-server", profileVersion: 1, policy: "local",
  readiness: readiness(state), queue: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
  capabilities: { localAnalysis: true, coding: false, voice: false, processSandbox: false },
});
function bridge() {
  return { runtimeStart: vi.fn(async () => ({ ok: true })), runtimeConnection: vi.fn(async () => connection) };
}
function serve(activeProfile = profile(), activeStatus = status()) {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    expect(new Headers(options?.headers).get("authorization")).toBe(`Bearer ${connection.token}`);
    if (url === `${connection.url}/v1/profile`) return Response.json(activeProfile);
    if (url === `${connection.url}/v1/status`) return Response.json(activeStatus);
    throw new Error(`Unexpected runtime operation: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(() => {
  vi.useFakeTimers();
  store.setSettings({
    ...previous, provider: "gemini", model: "gemini-2.5-flash", keys: { ...emptyKeys },
    proxyUrl: "", ollamaUrl: "", ollamaModelSimple: "", ollamaModelComplex: "", ollamaModelVision: "",
    webllmEnabled: false, onDeviceOnly: false,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  store.setSettings(previous);
});

describe("desktop runtime onboarding", () => {
  it("imports the installed text model without requiring READY or changing cloud choices and keys", async () => {
    const desktop = bridge();
    const fetcher = serve();
    const result = await bootstrapDesktopRuntime({ bridge: desktop });

    expect(result).toMatchObject({ state: "configured", model, readiness: "SETUP" });
    expect(result.message).toContain("nie jest jeszcze potwierdzona");
    expect(store.settings).toMatchObject({
      provider: "gemini", model: "gemini-2.5-flash", keys: emptyKeys,
      ollamaUrl: "http://127.0.0.1:11434", ollamaModelSimple: model, ollamaModelComplex: model, ollamaModelVision: "",
    });
    expect(desktop.runtimeStart).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.every(([url]) => /\/v1\/(profile|status)$/.test(url))).toBe(true);
  });

  it("reports confirmed readiness only for a fresh probe of the same active profile", async () => {
    serve(profile(), status("READY"));
    await expect(bootstrapDesktopRuntime({ bridge: bridge() })).resolves.toMatchObject({ readiness: "READY" });
  });

  it("does not reuse READY from a different profile revision", async () => {
    serve(profile({ version: 2 }), status("READY"));
    await expect(bootstrapDesktopRuntime({ bridge: bridge() })).resolves.toMatchObject({ readiness: "SETUP" });
  });

  it.each(["cloud", "local", "proxy"])("preserves an existing %s brain without starting or probing another service", async (kind) => {
    if (kind === "cloud") store.setSettings({ keys: { ...emptyKeys, gemini: "existing-key" } });
    if (kind === "local") store.setSettings({ ollamaUrl: "http://localhost:11434", ollamaModelSimple: "custom" });
    if (kind === "proxy") store.setSettings({ proxyUrl: "https://bff.example" });
    const snapshot = JSON.stringify(store.settings);
    const desktop = bridge();
    const fetcher = serve();

    await expect(bootstrapDesktopRuntime({ bridge: desktop })).resolves.toEqual({ state: "preserved" });
    expect(JSON.stringify(store.settings)).toBe(snapshot);
    expect(desktop.runtimeStart).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves choices entered while the service is starting", async () => {
    let finish!: (value: { ok: boolean }) => void;
    const desktop = { ...bridge(), runtimeStart: vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { finish = resolve; })) };
    serve();
    const pending = bootstrapDesktopRuntime({ bridge: desktop });
    store.setSettings({ provider: "groq", model: "custom-model", keys: { ...emptyKeys, groq: "new-user-key" } });
    finish({ ok: true });

    await expect(pending).resolves.toEqual({ state: "preserved" });
    expect(store.settings).toMatchObject({ provider: "groq", model: "custom-model", ollamaUrl: "", keys: { ...emptyKeys, groq: "new-user-key" } });
  });

  it("does not override a manually selected provider even if its new key is still empty", async () => {
    let finish!: (value: { ok: boolean }) => void;
    const desktop = { ...bridge(), runtimeStart: () => new Promise<{ ok: boolean }>((resolve) => { finish = resolve; }) };
    serve();
    const pending = bootstrapDesktopRuntime({ bridge: desktop });
    store.setSettings({ provider: "groq", model: "custom-model" });
    finish({ ok: true });
    await expect(pending).resolves.toEqual({ state: "preserved" });
    expect(store.settings.ollamaUrl).toBe("");
  });

  it("respects interaction with a wizard whose draft has not yet reached the store", async () => {
    serve();
    await expect(bootstrapDesktopRuntime({ bridge: bridge(), shouldApply: () => false })).resolves.toEqual({ state: "preserved" });
    expect(store.settings.ollamaUrl).toBe("");
  });

  it("retains an explicit local model choice when only the address is missing", async () => {
    store.setSettings({ provider: "ollama", model: "user-model" });
    serve();
    await expect(bootstrapDesktopRuntime({ bridge: bridge() })).resolves.toEqual({ state: "preserved" });
    expect(store.settings.model).toBe("user-model");
    expect(store.settings.ollamaUrl).toBe("");
  });

  it("waits for the backend to select an installed model during startup", async () => {
    let requests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/profile")
      ? profile({ model: ++requests === 1 ? "" : model }) : status())));
    const pending = bootstrapDesktopRuntime({ bridge: bridge(), intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toMatchObject({ state: "configured", model });
    expect(requests).toBe(2);
  });

  it.each(["https://remote.example", "http://127.0.0.1:11434/private", "http://token@localhost:11434"])("rejects automatic import of an unsafe/nonlocal endpoint %s", async (ollamaUrl) => {
    serve(profile({ ollamaUrl }));
    const pending = bootstrapDesktopRuntime({ bridge: bridge(), timeoutMs: 300, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toMatchObject({ state: "setup" });
    expect(store.settings.ollamaUrl).toBe("");
  });

  it.each(["runtimeStart", "runtimeConnection"] as const)("bounds a stalled %s IPC call to ten seconds", async (operation) => {
    const desktop = bridge();
    desktop[operation] = vi.fn(() => new Promise<never>(() => {}));
    const pending = bootstrapDesktopRuntime({ bridge: desktop });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toMatchObject({ state: "unavailable" });
    expect(store.settings.ollamaUrl).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels on unmount and cannot apply a late IPC response", async () => {
    const controller = new AbortController();
    let finish!: (value: { ok: boolean }) => void;
    const desktop = { ...bridge(), runtimeStart: () => new Promise<{ ok: boolean }>((resolve) => { finish = resolve; }) };
    const fetcher = serve();
    const pending = bootstrapDesktopRuntime({ bridge: desktop, signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ state: "cancelled" });
    finish({ ok: true });
    await Promise.resolve();
    expect(store.settings.ollamaUrl).toBe("");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns SETUP after the deadline when the runtime has no installed model", async () => {
    serve(profile({ model: "" }));
    const pending = bootstrapDesktopRuntime({ bridge: bridge(), timeoutMs: 300, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toMatchObject({ state: "setup" });
    expect(store.settings.ollamaUrl).toBe("");
  });
});
