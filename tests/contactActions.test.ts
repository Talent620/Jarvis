// === Akcje kontaktu (contactActions) — testy ===
// Klik kontaktu ZAWSZE musi mieć widoczny skutek: dlatego normalizacja telefonu, wykrycie braku
// kontaktu i filtr muszą być deterministyczne. S9-safe.
import { describe, it, expect } from "vitest";
import { cleanPhone, telHref, smsHref, findContactQuery, hasPhone, hasEmail, hasAnyContact, matchContactFilter } from "../src/lib/contactActions";

describe("contactActions — telefon", () => {
  it("czyści spacje/myślniki/nawiasy, zachowuje wiodący plus", () => {
    expect(cleanPhone("+48 500 390 009")).toBe("+48500390009");
    expect(cleanPhone("(12) 345-67-89")).toBe("123456789");
    expect(cleanPhone("tel. 600 100 200")).toBe("600100200");
  });
  it("usuwa plus w środku (tylko wiodący jest dozwolony)", () => {
    expect(cleanPhone("00+48+500")).toBe("0048500");
  });
  it("telHref pusty gdy brak cyfr; poprawny gdy są", () => {
    expect(telHref("")).toBe("");
    expect(telHref("brak")).toBe("");
    expect(telHref("500 390 009")).toBe("tel:500390009");
  });
  it("smsHref buduje sms: z oczyszczonego numeru (pusty gdy brak)", () => {
    expect(smsHref("500 390 009")).toBe("sms:500390009");
    expect(smsHref("")).toBe("");
  });
});

describe("contactActions — Znajdź kontakt", () => {
  it("findContactQuery łączy nazwę, adres i frazę kontaktu", () => {
    expect(findContactQuery({ company: "Salon Ola", address: "Kraków" })).toBe("Salon Ola Kraków kontakt telefon e-mail");
    expect(findContactQuery({ company: "Bar Beta" })).toBe("Bar Beta kontakt telefon e-mail");
  });
});

describe("contactActions — klasyfikacja i filtr", () => {
  const phoneOnly = { phone: "600100200" };
  const emailOnly = { email: "a@b.pl" };
  const both = { phone: "600100200", email: "a@b.pl" };
  const none = { phone: "  ", email: "niepoprawny" };

  it("hasPhone/hasEmail/hasAnyContact rozpoznają realny kontakt", () => {
    expect(hasPhone(phoneOnly)).toBe(true);
    expect(hasEmail(emailOnly)).toBe(true);
    expect(hasEmail(none)).toBe(false); // brak @
    expect(hasAnyContact(none)).toBe(false);
  });

  it("filtr all/phone/email/none dobiera właściwych kandydatów", () => {
    expect(matchContactFilter(phoneOnly, "all")).toBe(true);
    expect(matchContactFilter(phoneOnly, "phone")).toBe(true);
    expect(matchContactFilter(phoneOnly, "email")).toBe(false);
    expect(matchContactFilter(emailOnly, "email")).toBe(true);
    expect(matchContactFilter(both, "none")).toBe(false);
    expect(matchContactFilter(none, "none")).toBe(true);
  });
});
