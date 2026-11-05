// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmPendingRuntimeSubmission, forgetPendingRuntimeSubmission, loadPendingRuntimeSubmission, otherRuntimePendingSubmissions, preparePendingRuntimeSubmission, reconcilePendingRuntimeSubmission, runtimePendingStorageKey, runtimeSubmissionScope, submitPendingRuntimeJob } from "../src/lib/runtimePendingSubmission";
import type { RuntimeJob } from "../src/lib/localRuntimeClient";

const connection = { url: "http://127.0.0.1:3211", token: "private-bearer-never-in-pending" };
const scope = runtimeSubmissionScope(connection.url, "server-a");
const status = { serverId: scope.serverId, readiness: { state: "READY" }, queue: {}, capabilities: { requestLookup: true, serverIdentityGuard: true } };
const profile = { active: { model: "fixture-local-model" } };
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code });
const makeJob = (pending: { prompt: string; idempotencyKey: string }): RuntimeJob => ({ id: "confirmed-job", ...pending, status: "completed", createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:01.000Z", attempt: 1, result: "Fixture result" });

function service({ loseFirstAck = false, archived = false } = {}) {
  const jobs = new Map<string, RuntimeJob>();
  let posts = 0;
  const fetch = vi.fn(async (input: string, options?: RequestInit) => {
    const path = new URL(input).pathname;
    if (path === "/v1/status") return json(status);
    if (path === "/v1/profile") return json(profile);
    if (path.startsWith("/v1/jobs/request/")) {
      const job = jobs.get(path.split("/").at(-1)!);
      return job ? json({ job, archived }) : json({ error: { code: "JOB_NOT_FOUND", message: "Not found" } }, 404);
    }
    if (path === "/v1/jobs" && options?.method === "POST") {
      posts += 1;
      const body = JSON.parse(String(options.body));
      expect(body.expectedServerId).toBe(scope.serverId);
      if (!jobs.has(body.idempotencyKey)) jobs.set(body.idempotencyKey, makeJob(body));
      if (loseFirstAck && posts === 1) throw new TypeError("Acknowledgement lost after commit");
      return json({ job: jobs.get(body.idempotencyKey), reused: posts > 1 });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  return { jobs, fetch, posts: () => posts };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("durable local runtime submissions", () => {
  it("saves the exact submitted text after server-compatible trimming, scoped by URL and identity without the token", () => {
    const pending = preparePendingRuntimeSubmission(scope, "  Private text\nwith whitespace  ");
    expect(pending.prompt).toBe("Private text\nwith whitespace");
    expect(preparePendingRuntimeSubmission(runtimeSubmissionScope(`${connection.url}/`, scope.serverId), pending.prompt)).toEqual(pending);
    expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
    expect(JSON.stringify(localStorage)).not.toContain(connection.token);
    expect(runtimePendingStorageKey(scope)).toContain(encodeURIComponent(connection.url));
    expect(loadPendingRuntimeSubmission(runtimeSubmissionScope(connection.url, "server-b"))).toBeNull();
    expect(loadPendingRuntimeSubmission(runtimeSubmissionScope("http://localhost:3212", scope.serverId))).toBeNull();
    expect(() => preparePendingRuntimeSubmission(scope, "different text")).toThrow("Najpierw sprawdź");
    expect(loadPendingRuntimeSubmission(scope)?.prompt).toBe(pending.prompt);
  });

  it.each(["write", "readback"])("does not allow submission when durable storage fails at %s", mode => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const storage = { length: 0, key: () => null, getItem: () => null, setItem: () => { if (mode === "write") throw new DOMException("Quota", "QuotaExceededError"); }, removeItem: () => {} };
    expect(() => preparePendingRuntimeSubmission(scope, "Keep me", storage)).toThrow("Nic nie wysłano");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks corrupted records and storage denial instead of silently generating another key", () => {
    localStorage.setItem(runtimePendingStorageKey(scope), "{broken");
    expect(() => preparePendingRuntimeSubmission(scope, "Do not replace")).toThrow("uszkodzony");
    expect(localStorage.getItem(runtimePendingStorageKey(scope))).toBe("{broken");
    expect(() => loadPendingRuntimeSubmission(scope, { length: 0, key: () => null, getItem: () => { throw new Error("Denied"); }, setItem: () => {}, removeItem: () => {} })).toThrow("odczytać");
  });

  it("recovers a lost acknowledgement after module reload using only reads, including an archived accepted job", async () => {
    const api = service({ loseFirstAck: true, archived: true });
    const pending = preparePendingRuntimeSubmission(scope, "Accepted before disconnect");
    await expect(submitPendingRuntimeJob(connection, scope, pending)).rejects.toThrow("połączyć");
    expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
    vi.resetModules();
    const reloaded = await import("../src/lib/runtimePendingSubmission");
    const recovered = reloaded.loadPendingRuntimeSubmission(scope)!;
    expect(recovered.idempotencyKey).toBe(pending.idempotencyKey);
    await expect(reloaded.reconcilePendingRuntimeSubmission(connection, scope, recovered)).resolves.toMatchObject({ prompt: pending.prompt });
    expect(api.posts()).toBe(1); expect(api.jobs.size).toBe(1);
    expect(localStorage.getItem(runtimePendingStorageKey(scope, pending.idempotencyKey))).toBeNull();
  });

  it("explicitly retries the same key and prompt after a lost acknowledgement without creating another server job", async () => {
    const api = service({ loseFirstAck: true });
    const first = preparePendingRuntimeSubmission(scope, "Once only");
    await expect(submitPendingRuntimeJob(connection, scope, first)).rejects.toThrow();
    const remounted = loadPendingRuntimeSubmission(scope)!;
    await submitPendingRuntimeJob(connection, scope, remounted);
    expect(api.posts()).toBe(2); expect(api.jobs.size).toBe(1);
    const payloads = api.fetch.mock.calls.filter(([, options]) => options?.method === "POST").map(([, options]) => JSON.parse(String(options?.body)));
    expect(payloads[0]).toEqual(payloads[1]);
    expect(loadPendingRuntimeSubmission(scope)).toBeNull();
  });

  it("guards simultaneous clicks synchronously with one in-flight POST", async () => {
    const api = service();
    const pending = preparePendingRuntimeSubmission(scope, "One click pair");
    const first = submitPendingRuntimeJob(connection, scope, pending);
    const second = submitPendingRuntimeJob(connection, scope, pending);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(api.posts()).toBe(1);
  });

  it("does not send an old intent to another URL or a replacement server at the same URL", async () => {
    const api = service(); const pending = preparePendingRuntimeSubmission(scope, "Original service only");
    await expect(submitPendingRuntimeJob({ ...connection, url: "http://127.0.0.1:3212" }, scope, pending)).rejects.toThrow("innego adresu");
    expect(api.fetch).not.toHaveBeenCalled();
    api.fetch.mockImplementation(async () => json({ ...status, serverId: "server-b" }));
    await expect(submitPendingRuntimeJob(connection, scope, pending)).rejects.toThrow("inny serwer");
    expect(api.posts()).toBe(0); expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
    const replacementScope = runtimeSubmissionScope(connection.url, "server-b");
    const replacement = preparePendingRuntimeSubmission(replacementScope, "Separate new intent");
    expect(otherRuntimePendingSubmissions(replacementScope)).toEqual([{ scope, idempotencyKey: pending.idempotencyKey, pending }]);
    forgetPendingRuntimeSubmission(scope, pending.idempotencyKey);
    expect(loadPendingRuntimeSubmission(replacementScope)).toEqual(replacement);
  });

  it("retains the intent if the server changes after the preflight but rejects its expectedServerId", async () => {
    const api = service(); const pending = preparePendingRuntimeSubmission(scope, "Race guard");
    api.fetch.mockImplementation(async (input: string, options?: RequestInit) => options?.method === "POST" ? json({ error: { code: "SERVER_CHANGED", message: "Different server" } }, 409) : json(input.endsWith("/profile") ? profile : status));
    await expect(submitPendingRuntimeJob(connection, scope, pending)).rejects.toMatchObject({ status: 409, code: "SERVER_CHANGED" });
    expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
  });

  it.each(["key", "prompt"])("does not clear a pending intent when the acknowledged %s differs", async field => {
    const api = service(); const pending = preparePendingRuntimeSubmission(scope, "Match both fields");
    const wrongJob = makeJob({ ...pending, ...(field === "key" ? { idempotencyKey: "wrong-key" } : { prompt: "Wrong prompt" }) });
    api.fetch.mockImplementation(async (input: string, options?: RequestInit) => options?.method === "POST" ? json({ job: wrongJob }) : json(input.endsWith("/profile") ? profile : status));
    await expect(submitPendingRuntimeJob(connection, scope, pending)).rejects.toThrow("tego samego polecenia");
    expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
  });

  it("makes acknowledgement cleanup idempotent and never deletes a newer unrelated intent", () => {
    const old = preparePendingRuntimeSubmission(scope, "Already accepted"); const job = makeJob(old);
    confirmPendingRuntimeSubmission(scope, old, job);
    expect(() => confirmPendingRuntimeSubmission(scope, old, job)).not.toThrow();
    const next = preparePendingRuntimeSubmission(scope, "New request");
    expect(() => confirmPendingRuntimeSubmission(scope, old, job)).not.toThrow();
    expect(loadPendingRuntimeSubmission(scope)).toEqual(next);
  });

  it("preserves another tab's new record inserted between acknowledgement read and removal", () => {
    const old = preparePendingRuntimeSubmission(scope, "Old accepted intent");
    const next = { ...old, idempotencyKey: "new-intent-from-another-tab", prompt: "New unresolved intent", createdAt: old.createdAt + 1 };
    const oldKey = runtimePendingStorageKey(scope, old.idempotencyKey);
    const nextKey = runtimePendingStorageKey(scope, next.idempotencyKey);
    const records = new Map([[oldKey, JSON.stringify(old)]]);
    let interleaved = false;
    const storage = {
      get length() { return records.size; }, key: (index: number) => [...records.keys()][index] ?? null,
      getItem: (key: string) => {
        const value = records.get(key) ?? null;
        if (key === oldKey && !interleaved) { interleaved = true; records.set(nextKey, JSON.stringify(next)); }
        return value;
      },
      setItem: (key: string, value: string) => { records.set(key, value); },
      removeItem: (key: string) => { records.delete(key); },
    };
    confirmPendingRuntimeSubmission(scope, old, makeJob(old), storage);
    expect(interleaved).toBe(true);
    expect(records.has(oldKey)).toBe(false);
    expect(records.get(nextKey)).toBe(JSON.stringify(next));
    expect(loadPendingRuntimeSubmission(scope, storage)).toEqual(next);
    // A delayed duplicate receipt remains harmless when the next intent exists.
    confirmPendingRuntimeSubmission(scope, old, makeJob(old), storage);
    expect(records.get(nextKey)).toBe(JSON.stringify(next));
  });

  it("retains both separately created intents when two tabs prepare before seeing each other's write", () => {
    const records = new Map<string, string>();
    let interleaved = false;
    let second: ReturnType<typeof preparePendingRuntimeSubmission> | undefined;
    const storage = {
      get length() { return records.size; }, key: (index: number) => [...records.keys()][index] ?? null,
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (!interleaved) { interleaved = true; second = preparePendingRuntimeSubmission(scope, "Other tab's separate intent", storage); }
        records.set(key, value);
      },
      removeItem: (key: string) => { records.delete(key); },
    };
    const first = preparePendingRuntimeSubmission(scope, "First tab's intent", storage);
    expect(records.size).toBe(2); expect(second).toBeDefined();
    confirmPendingRuntimeSubmission(scope, first, makeJob(first), storage);
    expect(loadPendingRuntimeSubmission(scope, storage)).toEqual(second);
    forgetPendingRuntimeSubmission(scope, first.idempotencyKey, storage);
    expect(loadPendingRuntimeSubmission(scope, storage)).toEqual(second);
  });

  it("preserves an obsolete shared record without migrating or silently submitting it", () => {
    const pending = preparePendingRuntimeSubmission(scope, "Earlier shared record");
    localStorage.removeItem(runtimePendingStorageKey(scope, pending.idempotencyKey));
    localStorage.setItem(runtimePendingStorageKey(scope), JSON.stringify(pending));
    const write = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    expect(() => loadPendingRuntimeSubmission(scope)).toThrow("wcześniejszy wspólny zapis");
    expect(() => preparePendingRuntimeSubmission(scope, "Different request")).toThrow("Wysyłanie jest wstrzymane");
    expect(localStorage.getItem(runtimePendingStorageKey(scope))).toBe(JSON.stringify(pending));
    expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });

  it("never deletes a legacy record replaced by an older window during its read", () => {
    const old = preparePendingRuntimeSubmission(scope, "Shared record A");
    const newer = { ...old, idempotencyKey: "legacy-window-request-b", prompt: "Shared record B" };
    const key = runtimePendingStorageKey(scope);
    const records = new Map([[key, JSON.stringify(old)]]);
    const storage = {
      get length() { return records.size; }, key: (index: number) => [...records.keys()][index] ?? null,
      getItem: (requested: string) => { const value = records.get(requested) ?? null; if (requested === key) records.set(key, JSON.stringify(newer)); return value; },
      setItem: vi.fn((requested: string, value: string) => { records.set(requested, value); }),
      removeItem: vi.fn((requested: string) => { records.delete(requested); }),
    };
    expect(() => loadPendingRuntimeSubmission(scope, storage)).toThrow("wcześniejszy wspólny zapis");
    expect(records.get(key)).toBe(JSON.stringify(newer));
    expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("does not misinterpret an unsupported lookup endpoint as proof that a job was never accepted", async () => {
    const api = service(); const pending = preparePendingRuntimeSubmission(scope, "Uncertain outcome");
    api.fetch.mockImplementation(async (input: string) => input.endsWith("/status") ? json(status) : json({ error: { code: "NOT_FOUND", message: "Unsupported endpoint" } }, 404));
    await expect(reconcilePendingRuntimeSubmission(connection, scope, pending)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
    api.fetch.mockImplementation(async (input: string) => input.endsWith("/status") ? json(status) : json({ error: { code: "JOB_NOT_FOUND", message: "No job" } }, 404));
    await expect(reconcilePendingRuntimeSubmission(connection, scope, pending)).resolves.toBeNull();
    expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
    expect(api.posts()).toBe(0);
  });

  it("keeps an old-server lookup outcome unknown and blocks a POST without the identity guard", async () => {
    const api = service(); const pending = preparePendingRuntimeSubmission(scope, "Upgrade required");
    api.fetch.mockImplementation(async () => json({ ...status, capabilities: {} }));
    await expect(reconcilePendingRuntimeSubmission(connection, scope, pending)).rejects.toThrow("Nie oznacza");
    await expect(submitPendingRuntimeJob(connection, scope, pending)).rejects.toThrow("Zaktualizuj");
    expect(api.posts()).toBe(0); expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
  });

  it.each(["offline", "empty-profile"])("does not POST with an unverified or unusable service: %s", async mode => {
    const api = service(); const pending = preparePendingRuntimeSubmission(scope, "Wait until configured");
    api.fetch.mockImplementation(async (input: string) => { if (mode === "offline") throw new TypeError("offline"); return json(input.endsWith("/profile") ? { active: { model: "" } } : status); });
    await expect(submitPendingRuntimeJob(connection, scope, pending)).rejects.toThrow();
    expect(api.posts()).toBe(0); expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
  });

  it("reports retained private text if cleanup fails after confirmed acceptance, without sending another POST", async () => {
    const api = service(); const pending = preparePendingRuntimeSubmission(scope, "Remove after receipt");
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Denied"); });
    await expect(submitPendingRuntimeJob(connection, scope, pending)).rejects.toThrow("potwierdził przyjęcie");
    expect(loadPendingRuntimeSubmission(scope)).toEqual(pending);
    remove.mockRestore();
    await reconcilePendingRuntimeSubmission(connection, scope, pending);
    expect(loadPendingRuntimeSubmission(scope)).toBeNull(); expect(api.posts()).toBe(1);
  });
});
