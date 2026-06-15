// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { canSendDirect, hasBackendGmail, sendOfferEmail, sendMailNow, verifyMailConnection, recordSent, sendTestEmail, isSameDay, sentTodayCount } from "../src/lib/mailer";
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

describe("przekaźnik SMTP (telefon, bez Google OAuth)", () => {
  it("backend + hasło aplikacji, bez desktopu → wysyła przez /v1/smtp/send (via SMTP) i zapisuje", async () => {
    store.setData((d) => { d.sentMail = []; });
    store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok", smtpUser: "a@gmail.com", smtpPass: "haslo" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendOfferEmail("k@firma.pl", "Oferta", "Cześć", "Firma Z");
    expect(r).toEqual({ ok: true, via: "SMTP" });
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/smtp/send");
    expect(store.data.sentMail[0]).toMatchObject({ to: "k@firma.pl", via: "SMTP", company: "Firma Z" });
  });

  it("przekaźnik ma priorytet nad Gmailem OAuth (gdy jest hasło aplikacji)", async () => {
    store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok", smtpUser: "a@gmail.com", smtpPass: "haslo" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    await sendOfferEmail("k@firma.pl", "x", "y");
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/smtp/send");
  });

  it("backend zwraca błąd przekaźnika → czytelny komunikat", async () => {
    store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok", smtpUser: "a@gmail.com", smtpPass: "zle" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Logowanie odrzucone." }), { status: 502 })));
    const r = await sendOfferEmail("k@firma.pl", "x", "y");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Logowanie/);
  });

  it("verifyMailConnection przez przekaźnik (telefon) → połączono", async () => {
    store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok", smtpUser: "a@gmail.com", smtpPass: "haslo" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
    const r = await verifyMailConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/w tle|poprawnie/i);
  });
});

describe("Skrzynka wysłanych — licznik 'dziś'", () => {
  const now = new Date("2026-06-15T12:00:00").getTime();
  const todayMorning = new Date("2026-06-15T08:30:00").getTime();
  const yesterday = new Date("2026-06-14T23:00:00").getTime();

  it("isSameDay rozpoznaje ten sam dzień kalendarzowy", () => {
    expect(isSameDay(todayMorning, now)).toBe(true);
    expect(isSameDay(yesterday, now)).toBe(false);
  });

  it("sentTodayCount liczy tylko dzisiejsze", () => {
    const sent = [{ at: todayMorning }, { at: yesterday }, { at: now }];
    expect(sentTodayCount(sent, now)).toBe(2);
    expect(sentTodayCount([], now)).toBe(0);
  });
});

describe("sendTestEmail — test poczty do siebie", () => {
  it("wysyła na własny adres i NIE zapisuje w Skrzynce wysłanych", async () => {
    store.setData((d) => { d.sentMail = []; });
    store.setSettings({ smtpUser: "ja@gmail.com", smtpPass: "haslo" });
    (window as any).jarvisDesktop = { sendMail: vi.fn(async () => "ok") };
    const r = await sendTestEmail();
    expect(r.ok).toBe(true);
    expect(r.message).toContain("ja@gmail.com");
    expect(store.data.sentMail).toHaveLength(0); // test nie zaśmieca skrzynki
  });

  it("bez adresu → prosi o uzupełnienie", async () => {
    store.setSettings({ smtpUser: "", smtpPass: "" });
    const r = await sendTestEmail();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/adres/i);
  });

  it("adres jest, ale brak kanału wysyłki → czytelna podpowiedź", async () => {
    store.setSettings({ smtpUser: "ja@gmail.com", smtpPass: "" });
    const r = await sendTestEmail();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Windows|backend/i);
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
