import { describe, it, expect } from "vitest";
// Czyste funkcje natywnego OAuth desktop (electron/google.cjs) — testowalne bez Electrona.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const g = require("../electron/google.cjs");

describe("electron/google.cjs — buildAuthUrl (OAuth loopback dla .exe)", () => {
  it("buduje URL zgody z redirectem loopback na podanym porcie", () => {
    const u = new URL(g.buildAuthUrl("CID.apps.googleusercontent.com", 54321));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("CID.apps.googleusercontent.com");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:54321");
    expect(u.searchParams.get("access_type")).toBe("offline"); // potrzebne do refresh_token
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toMatch(/calendar\.events/);
  });

  it("eksportuje komplet funkcji integracji kalendarza", () => {
    for (const fn of ["buildAuthUrl", "exchangeCode", "refreshAccessToken", "connectGoogle", "calAdd", "calList"]) {
      expect(typeof g[fn]).toBe("function");
    }
  });
});
