// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { canSendDirect, hasBackendGmail, sendOfferEmail, sendMailNow, verifyMailConnection, recordSent } from "../src/lib/mailer";
import { store } from "../src/lib/store";

// Wybór kanału wysyłki: desktop→SMTP, telefon→Gmail(backend), inaczej→compose.

beforeEach(() => {
  store.setSettings({ smtpUser: "", smtpPass: "", syncUrl: "", syncToken: "" });
  delete (window as any).jarvisDesktop;
});
afterEach(() => { delete (window as any).jarvisDesktop; vi.unstubAllGlobals(); });

describe("wybór kanału wysyłki e-maila", () => {
  it("backend Gmail wykryty po adresie i tokenie synchronizacji", () => {
    expect(hasBackendGmail()).toBe(false);
    store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok" });
    expect(hasBackendGmail()).toBe(true);
    expect(canSendDirect()).toBe(true);
  });

  it("bez niczego: canSendDirect false → UI proponuje Gmail compose", async () => {
    const r = await sendOfferEmail("k@firma.pl", "Temat", "Treść");
    expect(r.ok).toBe(false);
    expect(canSendDirect()).toBe(false);
  });

  it("telefon z backendem: wysyła przez Gmail API (via Gmail)", async () => {
    store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
    const r = await sendOfferEmail("k@firma.pl", "Oferta", "Dzień dobry");
    expect(r).toEqual({ ok: true, via: "Gmail" });
  });

  it("backend zwraca błąd → przekazany czytelnie", async () => {
    store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Połącz konto Google." }), { status: 400 })));
    const r = await sendOfferEmail("k@firma.pl", "x", "y");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Google/);
  });

  it("desktop SMTP ma priorytet nad backendem (via SMTP)", async () => {
    store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok", smtpUser: "a@gmail.com", smtpPass: "haslo" });
    (window as any).jarvisDesktop = { sendMail: vi.fn(async () => "ok") };
    const r = await sendOfferEmail("k@firma.pl", "Oferta", "Cześć");
    expect(r).toEqual({ ok: true, via: "SMTP" });
  });

  it("most SMTP zwraca obiekt zamiast tekstu → czytelny błąd (nie „[object Object]”)", async () => {
    store.setSettings({ smtpUser: "a@gmail.com", smtpPass: "haslo" });
    (window as any).jarvisDesktop = { sendMail: vi.fn(async () => ({ weird: true })) };
    const err = await sendMailNow("k@firma.pl", "T", "B");
    expect(err).toBeTruthy();
    expect(err).not.toContain("[object Object]");
    expect(err).toMatch(/mostka SMTP|Poczt/i);
  });

  it("udana wysyłka SMTP zapisuje wpis w Skrzynce wysłanych (z firmą)", async () => {
    store.setData((d) => { d.sentMail = []; });
    store.setSettings({ smtpUser: "a@gmail.com", smtpPass: "haslo" });
    (window as any).jarvisDesktop = { sendMail: vi.fn(async () => "ok") };
    await sendOfferEmail("k@firma.pl", "Oferta", "Cześć", "Firma X");
    expect(store.data.sentMail).toHaveLength(1);
    expect(store.data.sentMail[0]).toMatchObject({ to: "k@firma.pl", subject: "Oferta", company: "Firma X", via: "SMTP" });
  });
});

describe("recordSent — skrzynka wysłanych", () => {
  it("dokłada najnowszy wpis na początek", () => {
    store.setData((d) => { d.sentMail = []; });
    recordSent({ to: "a@x.pl", subject: "A", via: "SMTP" });
    recordSent({ to: "b@x.pl", subject: "B", via: "Gmail" });
    expect(store.data.sentMail[0].to).toBe("b@x.pl");
    expect(store.data.sentMail).toHaveLength(2);
  });
});

describe("verifyMailConnection — sprawdzenie połączenia", () => {
  it("bez mostu desktop → podpowiedź dla telefonu", async () => {
    const r = await verifyMailConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Windows|Gmaila/);
  });

  it("most zwraca ok → połączono poprawnie", async () => {
    store.setSettings({ smtpUser: "a@gmail.com", smtpPass: "haslo" });
    (window as any).jarvisDesktop = { verifyMail: vi.fn(async () => "ok") };
    const r = await verifyMailConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/połączona poprawnie/i);
  });

  it("most zwraca err → czytelny komunikat bez prefiksu err:", async () => {
    store.setSettings({ smtpUser: "a@gmail.com", smtpPass: "zle" });
    (window as any).jarvisDesktop = { verifyMail: vi.fn(async () => "err:Logowanie odrzucone — hasło aplikacji.") };
    const r = await verifyMailConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Logowanie odrzucone — hasło aplikacji.");
  });

  it("brak adresu/hasła → prosi o uzupełnienie", async () => {
    store.setSettings({ smtpUser: "", smtpPass: "" });
    (window as any).jarvisDesktop = { verifyMail: vi.fn(async () => "ok") };
    const r = await verifyMailConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Najpierw wpisz/);
  });
});
