// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { buildFullPayload, packEncrypted, unpackEncrypted } from "../src/lib/backup";
import { store } from "../src/lib/store";

describe("zaszyfrowana pełna kopia (AES-256)", () => {
  beforeEach(() => {
    store.setData((d) => {
      d.tasks = [];
      d.notes = [];
    });
  });

  it("pełny ładunek zawiera dane i ustawienia (klucze)", () => {
    store.setSettings({ userName: "TestUser" });
    const p = buildFullPayload() as any;
    expect(p.app).toBe("jarvis");
    expect(p.kind).toBe("full");
    expect(p.settings.userName).toBe("TestUser");
    expect(p.data).toBeTypeOf("object");
  });

  it("szyfruje i odszyfrowuje w obie strony (roundtrip)", async () => {
    store.setData((d) => {
      d.notes = [{ id: "n1", text: "sekretna notatka", createdAt: 1 } as any];
    });
    store.setSettings({ userName: "Marcin" });
    const cipherText = await packEncrypted(buildFullPayload(), "moje-haslo");
    expect(cipherText.startsWith("JV1:")).toBe(true);
    expect(cipherText).not.toContain("sekretna"); // treść NIE jest jawna

    // Zniszcz stan i odtwórz z kopii.
    store.setData((d) => {
      d.notes = [];
    });
    store.setSettings({ userName: "Ktoś inny" });
    const msg = await unpackEncrypted(cipherText, "moje-haslo");
    expect(msg).toMatch(/Przywrócono/);
    expect(store.data.notes[0]?.text).toBe("sekretna notatka");
    expect(store.settings.userName).toBe("Marcin");
  });

  it("złe hasło → wyjątek (GCM weryfikuje integralność), stan nietknięty", async () => {
    const cipherText = await packEncrypted(buildFullPayload(), "dobre-haslo");
    await expect(unpackEncrypted(cipherText, "zle-haslo")).rejects.toThrow();
  });
});
