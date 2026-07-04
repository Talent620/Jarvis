// @vitest-environment jsdom
// Najprostsza wysyłka e-maila: gdy backend Gmail nie jest połączony, narzędzie
// gmail_send NIE zwraca błędu konfiguracji — otwiera gotową wiadomość do wysłania
// (fallback openCompose). Działa wszędzie, bez konfiguracji.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { runTool } from "../src/lib/tools";
import { store } from "../src/lib/store";
import { grantOutboundScope } from "../src/lib/permissions";

beforeEach(() => {
  grantOutboundScope("*"); // test bada fallback wysyłki, nie bramkę zgód (fail-closed)
  // Brak backendu Gmail (telefon bez OAuth) — wymuszamy ścieżkę fallback.
  store.setSettings({ syncUrl: "", syncToken: "" });
  // window.open w jsdom bywa nieobsłużone — podmieniamy na bezpieczny stub.
  vi.spyOn(window, "open").mockImplementation(() => null);
});

describe("gmail_send — najprostsza wysyłka (fallback)", () => {
  it("bez połączonego konta otwiera gotowy e-mail, nie zwraca błędu konfiguracji", async () => {
    const out = await runTool("gmail_send", {
      to: "ktos@example.com",
      subject: "Cześć",
      body: "Treść wiadomości",
    });
    expect(out.toLowerCase()).toContain("e-mail");
    expect(out).toContain("ktos@example.com");
    expect(out.toLowerCase()).not.toContain("skonfiguruj");
  });

  it("ze skonfigurowanym SMTP wysyła W APLIKACJI (nie otwiera zewnętrznego Gmaila)", async () => {
    // SMTP na „komputerze" (most Electrona) + dane poczty — bez Gmail OAuth.
    store.setSettings({ smtpUser: "ja@gmail.com", smtpPass: "haslo-aplikacji" });
    const sendMail = vi.fn(async () => "ok");
    (window as unknown as { jarvisDesktop: unknown }).jarvisDesktop = { sendMail };
    const openSpy = window.open as unknown as ReturnType<typeof vi.fn>;
    openSpy.mockClear?.();

    const out = await runTool("gmail_send", { to: "klient@firma.pl", subject: "Oferta", body: "Dzień dobry" });

    expect(sendMail).toHaveBeenCalledTimes(1); // wysłane SMTP-em w aplikacji
    expect(out).toMatch(/Wysłano e-mail do klient@firma\.pl \(SMTP\)/);
    expect(window.open).not.toHaveBeenCalled(); // NIE wychodzimy do zewnętrznego Gmaila
    delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop;
  });

  it("zły adres → jasny komunikat, bez próby wysyłki", async () => {
    const out = await runTool("gmail_send", { to: "to-nie-email", subject: "x", body: "y" });
    expect(out).toMatch(/nie wygląda na e-mail/i);
  });
});
