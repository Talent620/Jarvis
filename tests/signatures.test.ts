// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { upsertSignature, removeSignatureFrom, addSignature, listSignatures, useSignature, seedSignatures, activeSignatureBody } from "../src/lib/signatures";
import { store } from "../src/lib/store";
import type { Signature } from "../src/types";

const sig = (id: string, name = id, body = `tresc ${id}`): Signature => ({ id, name, body });

describe("signatures — pure helpery", () => {
  it("upsert dodaje nowy i aktualizuje istniejący po id", () => {
    let list: Signature[] = [];
    list = upsertSignature(list, sig("a"));
    expect(list).toHaveLength(1);
    list = upsertSignature(list, { ...sig("a"), name: "A2" });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("A2");
  });
  it("remove usuwa po id", () => {
    const list = [sig("a"), sig("b")];
    expect(removeSignatureFrom(list, "a")).toEqual([sig("b")]);
  });
});

describe("signatures — store wrappery", () => {
  beforeEach(() => store.setSettings({ signatures: [], emailSignature: "" }));

  it("add + list + useSignature ustawia aktywny emailSignature", () => {
    const a = addSignature("Firmowy", "Pozdrawiam, Firma");
    addSignature("Prywatny", "Pozdrawiam, Jan");
    expect(listSignatures()).toHaveLength(2);
    useSignature(a.id);
    expect(activeSignatureBody()).toBe("Pozdrawiam, Firma");
  });

  it("seedSignatures migruje istniejący podpis do listy, ale nie dubluje", () => {
    store.setSettings({ signatures: [], emailSignature: "Stary podpis" });
    seedSignatures();
    expect(listSignatures()).toHaveLength(1);
    expect(listSignatures()[0].body).toBe("Stary podpis");
    seedSignatures(); // drugie wywołanie nie dodaje
    expect(listSignatures()).toHaveLength(1);
  });
});
