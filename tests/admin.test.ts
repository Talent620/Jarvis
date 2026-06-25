// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { verifyOwnerPhone, saveAdminConfig, loadAdminConfig, hasAdminConfig } from "../src/lib/admin";

describe("Panel admina — weryfikacja hasła administratora", () => {
  it("akceptuje poprawne hasło administratora", async () => {
    expect(await verifyOwnerPhone("5498287x")).toBe(true);
  });
  it("odrzuca błędne hasło", async () => {
    expect(await verifyOwnerPhone("537885492")).toBe(false); // stare hasło już nie działa
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
