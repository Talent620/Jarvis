import { describe, it, expect } from "vitest";
import { isValidEmail, nextStatusAfterContact, autoConfirmsContact } from "../src/lib/leadContact";

describe("leadContact — prawda o kontakcie", () => {
  it("isValidEmail to wspólny walidator (akceptuje poprawne, odrzuca złe)", () => {
    expect(isValidEmail("kontakt@firma.pl")).toBe(true);
    expect(isValidEmail("zły adres")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });

  it("nextStatusAfterContact: świeży/kontakt → oferta", () => {
    expect(nextStatusAfterContact("new")).toBe("offer");
    expect(nextStatusAfterContact("contacted")).toBe("offer");
  });

  it("nextStatusAfterContact nie cofa zaawansowanych statusów", () => {
    expect(nextStatusAfterContact("offer")).toBe("offer");
    expect(nextStatusAfterContact("won")).toBe("won");
    expect(nextStatusAfterContact("lost")).toBe("lost");
  });

  it("autoConfirmsContact: tylko kanały z potwierdzeniem (SMTP/Sales OS)", () => {
    expect(autoConfirmsContact("smtp")).toBe(true);
    expect(autoConfirmsContact("salesos")).toBe(true);
    // zewnętrzne kompozytory — otwarcie nie jest dowodem wysyłki
    expect(autoConfirmsContact("gmail")).toBe(false);
    expect(autoConfirmsContact("mailto")).toBe(false);
    expect(autoConfirmsContact("sms")).toBe(false);
  });
});
