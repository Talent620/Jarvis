// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  draftKey,
  makeRecord,
  isDraftExpired,
  serializeDraft,
  parseDraft,
  readDraft,
  writeDraft,
  clearDraft,
  draftFits,
  DRAFT_NS,
  DRAFT_TTL_MS,
  DRAFT_MAX_CHARS,
  DRAFT_VERSION,
} from "../src/lib/draftStore";

// draftStore to warstwa TRWAŁOŚCI pracy w toku — testy pilnują, że praca NIE ginie
// (round-trip), ale też że śmieć/wygasłe/za-duże NIE wracają i nie wywracają aplikacji.

const NOW = 1_700_000_000_000;

describe("czyste rdzenie: serializacja / parsowanie / TTL / rozmiar", () => {
  it("round-trip: to, co zapisane, wraca identyczne", () => {
    const value = { html: "<h1>Strona</h1>", kind: "landing", steps: [1, 2, 3] };
    const raw = serializeDraft(value, NOW);
    expect(raw).toBeTypeOf("string");
    expect(parseDraft(raw, null, NOW)).toEqual(value);
  });
  it("makeRecord ma wersję i znacznik czasu", () => {
    const r = makeRecord("x", NOW);
    expect(r).toEqual({ v: DRAFT_VERSION, at: NOW, value: "x" });
  });
  it("brak danych / uszkodzony JSON → fallback (nigdy nie rzuca)", () => {
    expect(parseDraft(null, "FB", NOW)).toBe("FB");
    expect(parseDraft("{nie-json", "FB", NOW)).toBe("FB");
    expect(parseDraft("123", "FB", NOW)).toBe("FB"); // nie-obiekt
    expect(parseDraft('{"v":1}', "FB", NOW)).toBe("FB"); // brak pola value
  });
  it("zły numer wersji → fallback (odporność na przyszłe migracje)", () => {
    const raw = JSON.stringify({ v: 999, at: NOW, value: "x" });
    expect(parseDraft(raw, "FB", NOW)).toBe("FB");
  });
  it("wygasły szkic → fallback; świeży → wartość", () => {
    const raw = serializeDraft("praca", NOW)!;
    expect(parseDraft(raw, "FB", NOW + DRAFT_TTL_MS - 1)).toBe("praca"); // tuż przed TTL
    expect(parseDraft(raw, "FB", NOW + DRAFT_TTL_MS)).toBe("FB");        // dokładnie TTL → wygasł
  });
  it("isDraftExpired: brak znacznika traktuje jak świeży (nie kasuje niechcący)", () => {
    expect(isDraftExpired(null, NOW)).toBe(false);
    expect(isDraftExpired({}, NOW)).toBe(false);
    expect(isDraftExpired({ at: NOW - DRAFT_TTL_MS }, NOW)).toBe(true);
  });
  it("wartość za duża → serializacja odmawia (bezpiecznik localStorage)", () => {
    const huge = "x".repeat(DRAFT_MAX_CHARS + 100);
    expect(serializeDraft(huge, NOW)).toBeNull();
    expect(draftFits(huge)).toBe(false);
    expect(draftFits("mała wartość")).toBe(true);
  });
  it("wartość nieserializowalna (cykl) → null, nie wyjątek", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(serializeDraft(cyclic, NOW)).toBeNull();
  });
  it("draftKey namespace’uje nazwę", () => {
    expect(draftKey("webstudio.html")).toBe(`${DRAFT_NS}webstudio.html`);
  });
});

describe("I/O na localStorage (jsdom)", () => {
  beforeEach(() => { localStorage.clear(); });

  it("writeDraft → readDraft odtwarza pracę po „ponownym wejściu”", () => {
    expect(writeDraft("webstudio.html", "<main>OK</main>", NOW)).toBe(true);
    // symulacja świeżego montażu panelu: czytamy z fallbackiem pustym
    expect(readDraft("webstudio.html", "", NOW)).toBe("<main>OK</main>");
  });
  it("brak wpisu → fallback (czysty start)", () => {
    expect(readDraft("nieistnieje", "PUSTE", NOW)).toBe("PUSTE");
  });
  it("wygasły wpis jest ignorowany I sprzątany przy odczycie", () => {
    writeDraft("stary", "śmieć", NOW - DRAFT_TTL_MS - 1);
    expect(readDraft("stary", "FB", NOW)).toBe("FB");
    // po odczycie wpis powinien zniknąć (żeby nie wracał)
    expect(localStorage.getItem(draftKey("stary"))).toBeNull();
  });
  it("clearDraft usuwa szkic (np. po zapisaniu ukończonej pracy)", () => {
    writeDraft("mail.body", "treść", NOW);
    clearDraft("mail.body");
    expect(readDraft("mail.body", "", NOW)).toBe("");
  });
  it("za duży szkic nie jest zapisywany, a odczyt daje fallback (praca zostaje w pamięci sesji)", () => {
    const huge = "x".repeat(DRAFT_MAX_CHARS + 1);
    expect(writeDraft("wielki", huge, NOW)).toBe(false);
    expect(readDraft("wielki", "FB", NOW)).toBe("FB");
  });
  it("dwa różne szkice nie kolidują (namespacing per nazwa)", () => {
    writeDraft("a", "AAA", NOW);
    writeDraft("b", "BBB", NOW);
    expect(readDraft("a", "", NOW)).toBe("AAA");
    expect(readDraft("b", "", NOW)).toBe("BBB");
  });
});
