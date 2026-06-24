// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  emailFormatOk, domainOf, isDisposableEmail, sentCountToday, throttleBaseMs,
  sendGate, isBlacklisted, blacklistEmail,
} from "../src/lib/sales/deliverability";

describe("walidacja adresu", () => {
  it("format", () => {
    expect(emailFormatOk("k@firma.pl")).toBe(true);
    expect(emailFormatOk("zły adres")).toBe(false);
    expect(emailFormatOk("brak@kropki")).toBe(false);
    expect(emailFormatOk("")).toBe(false);
  });
  it("domena", () => {
    expect(domainOf("K@Firma.PL")).toBe("firma.pl");
    expect(domainOf("nieprawidłowy")).toBe("");
  });
  it("adresy jednorazowe", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("a@yopmail.com")).toBe(true);
    expect(isDisposableEmail("a@firma.pl")).toBe(false);
  });
});

describe("liczenie dziennej wysyłki (pure)", () => {
  it("liczy tylko maile z dzisiaj", () => {
    const now = new Date("2026-06-24T12:00:00").getTime();
    const yest = now - 86_400_000;
    expect(sentCountToday([{ at: now }, { at: now - 3_600_000 }, { at: yest }], now)).toBe(2);
    expect(sentCountToday([], now)).toBe(0);
  });
});

describe("throttling (pure)", () => {
  it("rośnie z liczbą wysłanych, do sufitu", () => {
    expect(throttleBaseMs(0)).toBe(20_000);
    expect(throttleBaseMs(10)).toBe(35_000);
    expect(throttleBaseMs(1000)).toBe(90_000); // cap
    expect(throttleBaseMs(-5)).toBe(20_000);   // odporne na ujemne
  });
});

describe("sendGate (pure) — bramka decyzji", () => {
  const base = { email: "k@firma.pl", sentToday: 0, dailyLimit: 0, blacklisted: false };
  it("przepuszcza poprawny adres z opóźnieniem", () => {
    const g = sendGate(base);
    expect(g.allow).toBe(true);
    expect(g.delayMs).toBeGreaterThan(0);
  });
  it("blokuje zły format", () => {
    expect(sendGate({ ...base, email: "nope" }).allow).toBe(false);
  });
  it("blokuje czarną listę", () => {
    expect(sendGate({ ...base, blacklisted: true }).allow).toBe(false);
  });
  it("blokuje adres jednorazowy", () => {
    expect(sendGate({ ...base, email: "x@mailinator.com" }).allow).toBe(false);
  });
  it("blokuje brak MX", () => {
    expect(sendGate({ ...base, mxOk: false }).allow).toBe(false);
  });
  it("nie blokuje gdy MX nieznane (undefined)", () => {
    expect(sendGate({ ...base, mxOk: undefined }).allow).toBe(true);
  });
  it("respektuje dzienny limit", () => {
    expect(sendGate({ ...base, sentToday: 50, dailyLimit: 50 }).allow).toBe(false);
    expect(sendGate({ ...base, sentToday: 49, dailyLimit: 50 }).allow).toBe(true);
    expect(sendGate({ ...base, sentToday: 999, dailyLimit: 0 }).allow).toBe(true); // 0 = bez limitu
  });
});

describe("czarna lista (localStorage)", () => {
  beforeEach(() => localStorage.clear());
  it("zapisuje i odczytuje", () => {
    expect(isBlacklisted("k@firma.pl")).toBe(false);
    blacklistEmail("K@Firma.PL", "bounce");
    expect(isBlacklisted("k@firma.pl")).toBe(true); // case-insensitive
  });
});
