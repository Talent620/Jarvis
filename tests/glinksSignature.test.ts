import { describe, it, expect } from "vitest";
import { appendSignature, splitOffer } from "../src/lib/glinks";

const SIG = "—\ntel. +48 500 390 009\nwww.v-ai.pl";

describe("appendSignature — automatyczna stopka", () => {
  it("dopisuje podpis na końcu treści", () => {
    expect(appendSignature("Dzień dobry, mam ofertę.", SIG)).toBe(`Dzień dobry, mam ofertę.\n\n${SIG}`);
  });

  it("nie dubluje, gdy podpis już jest w treści", () => {
    const body = `Treść.\n\n${SIG}`;
    expect(appendSignature(body, SIG)).toBe(body);
  });

  it("pusty podpis nie zmienia treści (poza przycięciem)", () => {
    expect(appendSignature("Treść.  ", "")).toBe("Treść.");
    expect(appendSignature("Treść.", undefined)).toBe("Treść.");
  });

  it("pusta treść = sam podpis", () => {
    expect(appendSignature("", SIG)).toBe(SIG);
  });
});

describe("splitOffer z podpisem", () => {
  it("wyciąga temat i dokleja podpis do treści", () => {
    const offer = "Temat: Strona dla Kowalski\nDzień dobry, zauważyłem…";
    const { subject, body } = splitOffer(offer, "fallback", SIG);
    expect(subject).toBe("Strona dla Kowalski");
    expect(body).toBe(`Dzień dobry, zauważyłem…\n\n${SIG}`);
  });

  it("bez podpisu działa jak dawniej (kompatybilność)", () => {
    const { subject, body } = splitOffer("Treść bez tematu", "Oferta");
    expect(subject).toBe("Oferta");
    expect(body).toBe("Treść bez tematu");
  });

  it("numer telefonu i strona są obecne w gotowej treści", () => {
    const { body } = splitOffer("Temat: x\nCześć", "f", SIG);
    expect(body).toContain("+48 500 390 009");
    expect(body).toContain("www.v-ai.pl");
  });
});
