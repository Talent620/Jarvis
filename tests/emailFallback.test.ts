// @vitest-environment jsdom
// Najprostsza wysyłka e-maila: gdy backend Gmail nie jest połączony, narzędzie
// gmail_send NIE zwraca błędu konfiguracji — otwiera gotową wiadomość do wysłania
// (fallback openCompose). Działa wszędzie, bez konfiguracji.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { runTool } from "../src/lib/tools";
import { store } from "../src/lib/store";

beforeEach(() => {
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
});
