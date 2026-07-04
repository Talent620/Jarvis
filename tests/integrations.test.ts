// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { formatPrice } from "../src/lib/markets";
import { runAutomation, automationReady } from "../src/lib/n8n";
import { store } from "../src/lib/store";

describe("markets.formatPrice", () => {
  it("duże liczby bez ułamków, małe z większą precyzją", () => {
    expect(formatPrice(64210)).toMatch(/64/);
    expect(formatPrice(2.5)).toBe("2.50");
    expect(formatPrice(0.0123)).toBe("0.0123");
  });
});

describe("n8n — warstwa wykonawcza", () => {
  beforeEach(() => store.setSettings({ n8nUrl: "", n8nToken: "" }));

  it("bez adresu webhooka → nie jest gotowa i zwraca instrukcję", async () => {
    expect(automationReady()).toBe(false);
    const r = await runAutomation("send_outreach", { to: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/n8n/i);
  });

  it("z adresem → gotowa do działania", () => {
    store.setSettings({ n8nUrl: "https://n8n.example/webhook/jarvis" });
    expect(automationReady()).toBe(true);
  });
});
