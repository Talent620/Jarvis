// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { displayedRuntimeState, forgetRuntimeConnection, loadRuntimeConnection, normalizeRuntimeUrl, requestRuntimeStart, runtimeRequest, saveRuntimeConnection, waitForRuntimeConnection } from "../src/lib/localRuntimeClient";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

describe("local runtime client", () => {
  it("never sends a bearer token over public HTTP or credential-bearing URLs", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const url of ["http://example.com", "https://user:password@example.com", "https://example.com?token=secret", "https://example.com/path"]) {
      await expect(runtimeRequest({ url, token: "token" }, "/v1/status")).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(normalizeRuntimeUrl(" http://127.0.0.1:3211/ ")).toBe("http://127.0.0.1:3211");
    expect(normalizeRuntimeUrl("https://jarvis.example")).toBe("https://jarvis.example");
  });

  it("makes authenticated requests without cookies and rejects redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [] }), { status: 200 })); vi.stubGlobal("fetch", fetch);
    await expect(runtimeRequest({ url: "http://localhost:3211", token: "test-token" }, "/v1/jobs", { method: "POST", body: { prompt: "Analyze", idempotencyKey: "same-request" } })).resolves.toEqual({ jobs: [] });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("http://localhost:3211/v1/jobs");
    expect(options).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" } });
    expect(JSON.parse(options.body)).toEqual({ prompt: "Analyze", idempotencyKey: "same-request" });
  });

  it("reports access failure and redacts its own token from server errors", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Bad token secret-value" } }), { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    const connection = { url: "http://localhost:3211", token: "secret-value" };
    await expect(runtimeRequest(connection, "/v1/status")).rejects.toThrow("odmówił dostępu");
    await expect(runtimeRequest(connection, "/v1/status")).rejects.toThrow("Bad token [ukryto token]");
  });

  it("does not present expired or disconnected readiness as ready", () => {
    const readiness = { state: "READY" as const, checkedAt: new Date(1000).toISOString(), expiresAt: new Date(2000).toISOString(), reason: "Passed" };
    expect(displayedRuntimeState(readiness, true, 1500)).toBe("READY");
    expect(displayedRuntimeState(readiness, true, 2000)).toBe("DEGRADED");
    expect(displayedRuntimeState(readiness, false, 1500)).toBe("OFFLINE");
    expect(displayedRuntimeState({ ...readiness, expiresAt: null }, true, 1500)).toBe("DEGRADED");
    expect(displayedRuntimeState(undefined, true)).toBe("UNKNOWN");
  });

  it("times out a stalled request with an explicit uncertain submission outcome", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    await expect(runtimeRequest({ url: "http://localhost:3211", token: "token" }, "/v1/jobs", { timeoutMs: 5 })).rejects.toThrow("mogło zostać przyjęte");
  });

  it("persists and removes only this device's runtime connection", () => {
    localStorage.setItem("jarvis.settings.v2", JSON.stringify({ userName: "unchanged" }));
    saveRuntimeConnection({ url: "http://127.0.0.1:3211/", token: " token " });
    expect(loadRuntimeConnection()).toEqual({ url: "http://127.0.0.1:3211", token: "token" });
    forgetRuntimeConnection();
    expect(loadRuntimeConnection()).toBeNull();
    expect(JSON.parse(localStorage.getItem("jarvis.settings.v2")!)).toEqual({ userName: "unchanged" });
  });

  it("waits through startup and verifies a connection file before accepting it", async () => {
    vi.useFakeTimers();
    const connection = { url: "http://127.0.0.1:3211", token: "local-token" };
    const read = vi.fn().mockRejectedValueOnce(new Error("Starting")).mockResolvedValueOnce(null).mockResolvedValue(connection);
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Stale connection"))
      .mockResolvedValue(new Response(JSON.stringify({ readiness: { state: "SETUP" }, queue: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const discovered = waitForRuntimeConnection(read, { timeoutMs: 100, intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(40);
    await expect(discovered).resolves.toEqual(connection);
    expect(read).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("ends discovery quietly when no service appears within its deadline", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue(null);
    const discovered = waitForRuntimeConnection(read, { timeoutMs: 30, intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(30);
    await expect(discovered).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("cancels discovery promptly when the panel closes", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const read = vi.fn().mockResolvedValue(null);
    const discovered = waitForRuntimeConnection(read, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await expect(discovered).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled desktop bridge call by the discovery deadline", async () => {
    vi.useFakeTimers();
    const discovered = waitForRuntimeConnection(() => new Promise(() => {}), { timeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(30);
    await expect(discovered).resolves.toBeNull();
  });

  it("aborts even while the desktop bridge is stalled", async () => {
    const controller = new AbortController();
    const discovered = waitForRuntimeConnection(() => new Promise(() => {}), { signal: controller.signal });
    controller.abort();
    await expect(discovered).resolves.toBeNull();
  });

  it("releases the start button if the desktop launch IPC never replies", async () => {
    vi.useFakeTimers();
    const started = requestRuntimeStart(() => new Promise(() => {}), { timeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(30);
    await expect(started).resolves.toMatchObject({ ok: false, error: expect.stringContaining("dłużej") });
  });
});
