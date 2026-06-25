import { describe, it, expect } from "vitest";
import { revokeId, isRevokedIn, isRevoked } from "../src/lib/revoked";

describe("revoked — kill-switch kluczy offline", () => {
  it("revokeId buduje identyfikator nazwa|iat", () => {
    expect(revokeId("tester młody", 1719500000000)).toBe("tester młody|1719500000000");
    expect(revokeId(undefined, undefined)).toBe("|0");
  });

  it("isRevokedIn trafia tylko w dokładny identyfikator", () => {
    const set = new Set(["tester młody|1719500000000"]);
    expect(isRevokedIn(set, "tester młody", 1719500000000)).toBe(true);
    expect(isRevokedIn(set, "tester młody", 1)).toBe(false); // inny iat
    expect(isRevokedIn(set, "ktoś inny", 1719500000000)).toBe(false); // inna nazwa
  });

  it("domyślnie lista jest pusta → nic nie jest unieważnione", () => {
    expect(isRevoked("ktokolwiek", 123)).toBe(false);
  });
});
