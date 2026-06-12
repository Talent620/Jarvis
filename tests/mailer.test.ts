// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { canSendDirect, hasBackendGmail, sendOfferEmail } from "../src/lib/mailer";
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
});
