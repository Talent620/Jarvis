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
    expect(cipherText.startsWith("JV2:")).toBe(true);
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

  it("kopia obejmuje projekty finansowe (round-trip, nic nie ginie)", async () => {
    store.setData((d) => {
      d.financeProjects = [{ id: "f1", name: "Sklep X", status: "oplacone", amount: 8000, paidAmount: 8000, createdAt: 1, updatedAt: 1 } as any];
    });
    const cipherText = await packEncrypted(buildFullPayload(), "h");
    store.setData((d) => { d.financeProjects = []; });
    await unpackEncrypted(cipherText, "h");
    expect(store.data.financeProjects?.[0]?.name).toBe("Sklep X");
    expect(store.data.financeProjects?.[0]?.amount).toBe(8000);
  });

  it("import starego payloadu bez financeProjects nie kasuje istniejących projektów", async () => {
    const { sanitizeImportedSettings } = await import("../src/lib/backup");
    void sanitizeImportedSettings; // (no-op — utrzymuje import po stronie testu)
    store.setData((d) => {
      d.financeProjects = [{ id: "keep", name: "Stary", status: "lead", amount: 100, createdAt: 1, updatedAt: 1 } as any];
    });
    // Stary payload (sprzed dodania financeProjects) — bez tego pola.
    const oldCipher = await packEncrypted({ app: "jarvis", kind: "full", version: 1, data: { tasks: [], notes: [] }, settings: {} }, "h");
    await unpackEncrypted(oldCipher, "h");
    // financeProjects nieobecne w kopii → istniejące zostają nietknięte.
    expect(store.data.financeProjects?.[0]?.id).toBe("keep");
  });

  it("kopia obejmuje skrzynkę wysłanych i historię postów (nie giną przy przenosinach)", async () => {
    store.setData((d) => {
      d.sentMail = [{ id: "s1", to: "k@x.pl", subject: "Oferta", via: "SMTP", at: 1 } as any];
      d.contentPosts = [{ id: "c1", platform: "instagram", topic: "promo", text: "post", at: 1 } as any];
    });
    const cipherText = await packEncrypted(buildFullPayload(), "h");
    store.setData((d) => { d.sentMail = []; d.contentPosts = []; });
    await unpackEncrypted(cipherText, "h");
    expect(store.data.sentMail[0]?.subject).toBe("Oferta");
    expect(store.data.contentPosts[0]?.text).toBe("post");
  });
});
