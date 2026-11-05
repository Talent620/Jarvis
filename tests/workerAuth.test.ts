import { afterEach, describe, it, expect, vi } from "vitest";
vi.mock("cloudflare:sockets", () => ({ connect: () => ({}) }));
import worker, { appTokenBad } from "../proxy/worker.js";

afterEach(() => vi.unstubAllGlobals());

// Pomocniczy „request" z nagłówkiem x-app-token.
const req = (token?: string) => ({ headers: { get: (h: string) => (h === "x-app-token" && token != null ? token : null) } });

describe("worker appTokenBad — tryb domyślny (zgodny wstecz)", () => {
  it("APP_TOKEN nieustawiony → przepuszcza (bez zmian)", () => {
    expect(appTokenBad(req(), {})).toBe(false);
    expect(appTokenBad(req("cokolwiek"), {})).toBe(false);
  });

  it("APP_TOKEN ustawiony → wymaga zgodnego tokenu", () => {
    const env = { APP_TOKEN: "sekret" };
    expect(appTokenBad(req("sekret"), env)).toBe(false);
    expect(appTokenBad(req("zly"), env)).toBe(true);
    expect(appTokenBad(req(), env)).toBe(true);
  });
});

describe("worker appTokenBad — fail-closed (REQUIRE_APP_TOKEN=1, opt-in)", () => {
  it("brak skonfigurowanego APP_TOKEN → odrzuca (fail-closed)", () => {
    expect(appTokenBad(req("x"), { REQUIRE_APP_TOKEN: "1" })).toBe(true);
  });

  it("APP_TOKEN ustawiony → przepuszcza tylko zgodny token", () => {
    const env = { REQUIRE_APP_TOKEN: "1", APP_TOKEN: "sekret" };
    expect(appTokenBad(req("sekret"), env)).toBe(false);
    expect(appTokenBad(req("zly"), env)).toBe(true);
    expect(appTokenBad(req(), env)).toBe(true);
  });
});

describe("protected BFF browser requests", () => {
  const env = { APP_TOKEN: "application-token", ANTHROPIC_API_KEY: "server-provider-key" };

  it("allows the app-token header in the browser CORS preflight", async () => {
    const response = await worker.fetch(new Request("https://bff.example/anthropic", {
      method: "OPTIONS",
      headers: {
        origin: "https://jarvis.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, x-app-token",
      },
    }), env);
    expect(response.ok).toBe(true);
    const allowed = response.headers.get("access-control-allow-headers")!.split(",").map((header) => header.trim().toLowerCase());
    expect(allowed).toContain("content-type");
    expect(allowed).toContain("x-app-token");
  });

  it("still rejects a POST without its app token before contacting the provider", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request("https://bff.example/anthropic", { method: "POST", body: "{}" }), env);
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("injects the server provider key when the browser supplies only its app token", async () => {
    const upstream = vi.fn(async (_url: string, _request: RequestInit) => Response.json({ content: [{ type: "text", text: "OK" }] }));
    vi.stubGlobal("fetch", upstream);
    const response = await worker.fetch(new Request("https://bff.example/anthropic", {
      method: "POST", body: JSON.stringify({ model: "test-model", messages: [] }),
      headers: { "content-type": "application/json", "x-app-token": "application-token" },
    }), env);

    expect(response.ok).toBe(true);
    expect(upstream).toHaveBeenCalledOnce();
    const [url, request] = upstream.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(request.headers).get("x-api-key")).toBe("server-provider-key");
    expect(new Headers(request.headers).has("x-app-token")).toBe(false);
  });
});
