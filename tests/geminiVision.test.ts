import { describe, it, expect } from "vitest";
import { classifyVisualIntent, validateInvoiceExtraction, validateCardExtraction, proposalText } from "../src/lib/multimodalContext";

describe("multimodalContext — rozpoznanie intencji wizualnej", () => {
  it("klasyfikuje fakturę/wizytówkę/screen/dokument", () => {
    expect(classifyVisualIntent("odczytaj fakturę")).toBe("invoice");
    expect(classifyVisualIntent("to wizytówka, dodaj kontakt")).toBe("card");
    expect(classifyVisualIntent("zrzut strony — zrób audyt")).toBe("screenshot");
    expect(classifyVisualIntent("streść ten dokument")).toBe("document");
    expect(classifyVisualIntent("co to?")).toBe("general");
  });
});

describe("multimodalContext — faktura: walidacja (zero zmyślonej księgowości)", () => {
  it("poprawna faktura → draft valid + propozycja DRAFT", () => {
    const d = validateInvoiceExtraction({ amount: "8 000,00", client: "Firma X", nip: "1234563218", number: "FV/1" });
    expect(d.valid).toBe(true);
    expect(d.amount).toBe(8000);
    expect(d.client).toBe("Firma X");
    expect(proposalText("invoice", d)).toMatch(/DRAFT/);
  });

  it("kwota ujemna / brak kwoty → ostrzeżenie, valid=false, nic nie zapisujemy", () => {
    expect(validateInvoiceExtraction({ amount: -5, client: "X" }).valid).toBe(false);
    const noAmt = validateInvoiceExtraction({ client: "X" });
    expect(noAmt.valid).toBe(false);
    expect(noAmt.warnings.join(" ")).toMatch(/kwot/i);
    expect(proposalText("invoice", noAmt)).toMatch(/Nic nie zapisuję/);
  });

  it("NIP o złej długości → ostrzeżenie", () => {
    expect(validateInvoiceExtraction({ amount: 100, client: "X", nip: "123" }).warnings.join(" ")).toMatch(/NIP/);
  });
});

describe("multimodalContext — wizytówka: walidacja", () => {
  it("poprawna wizytówka → lead draft", () => {
    const d = validateCardExtraction({ company: "Firma X", email: "kontakt@firmax.pl", phone: "+48 600 100 200" });
    expect(d.valid).toBe(true);
    expect(d.email).toBe("kontakt@firmax.pl");
    expect(proposalText("card", d)).toMatch(/Sprzedaży/);
  });

  it("zły e-mail jest odrzucany (nie halucynujemy kontaktu)", () => {
    const d = validateCardExtraction({ company: "X", email: "to-nie-email", phone: "600100200" });
    expect(d.email).toBeUndefined();
    expect(d.warnings.join(" ")).toMatch(/e-mail/i);
  });

  it("brak firmy/osoby i kontaktu → valid=false", () => {
    expect(validateCardExtraction({}).valid).toBe(false);
  });
});
