import { describe, it, expect, vi } from "vitest";
vi.mock("cloudflare:sockets", () => ({ connect: () => ({}) }));
import { appTokenBad } from "../proxy/worker.js";

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
