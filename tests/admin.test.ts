// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { verifyOwnerPhone, saveAdminConfig, loadAdminConfig, hasAdminConfig } from "../src/lib/admin";

describe("Panel admina — weryfikacja właściciela numerem", () => {
  it("akceptuje poprawny numer właściciela (i ignoruje spacje/myślniki)", async () => {
    expect(await verifyOwnerPhone("537885492")).toBe(true);
    expect(await verifyOwnerPhone("537 885 492")).toBe(true);
    expect(await verifyOwnerPhone("537-885-492")).toBe(true);
  });
  it("odrzuca błędny numer", async () => {
    expect(await verifyOwnerPhone("123456789")).toBe(false);
    expect(await verifyOwnerPhone("")).toBe(false);
  });
});

describe("Panel admina — sekrety szyfrowane numerem", () => {
  beforeEach(() => localStorage.clear());

  it("zapis i odczyt sekretów działa tylko z właściwym numerem", async () => {
    await saveAdminConfig("537885492", { workerUrl: "https://w.dev", adminToken: "tajny", notes: "klucz prywatny" });
    expect(hasAdminConfig()).toBe(true);

    const good = await loadAdminConfig("537885492");
    expect(good?.adminToken).toBe("tajny");
    expect(good?.workerUrl).toBe("https://w.dev");

    const bad = await loadAdminConfig("000000000"); // zły numer → nie odszyfruje
    expect(bad).toBeNull();
  });

  it("brak zapisanych sekretów → pusta konfiguracja (nie błąd)", async () => {
    const c = await loadAdminConfig("537885492");
    expect(c).toEqual({ workerUrl: "", adminToken: "" });
  });
});
