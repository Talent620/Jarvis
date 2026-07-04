// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { followUpContext } from "../src/lib/followUpAI";
import { store } from "../src/lib/store";
import type { Lead } from "../src/types";

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "1", company: "Kawiarnia Pod Lipą", niche: "gastronomia", location: "Kraków",
  url: "https://podlipa.pl", status: "contacted", createdAt: 0, updatedAt: 0,
  lastContactedAt: Date.now() - 4 * 86_400_000,
  intel: { score: 70, analysis: "Brak menu na mobile; wolne ładowanie.", email: "Temat: oferta\n\nDzień dobry, ...", updatedAt: 0 },
  ...over,
});

describe("followUpContext — kontekst dla dynamicznego follow-upu", () => {
  beforeEach(() => store.setSettings({ userName: "Marcin" }));

  it("zawiera firmę, branżę, stronę, słabe punkty i numer próby", () => {
    const c = followUpContext(lead(), 2);
    expect(c).toMatch(/Kawiarnia Pod Lipą/);
    expect(c).toMatch(/gastronomia/);
    expect(c).toMatch(/podlipa\.pl/);
    expect(c).toMatch(/Brak menu na mobile/);
    expect(c).toMatch(/Numer próby follow-upu: 2/);
  });

  it("liczy dni od kontaktu i nawiązuje do poprzedniej wiadomości", () => {
    const c = followUpContext(lead(), 1);
    expect(c).toMatch(/Dni od ostatniego kontaktu: 4/);
    expect(c).toMatch(/Poprzednia wysłana wiadomość/);
  });

  it("ostatnia próba (>=3) → instrukcja eleganckiego zamknięcia", () => {
    expect(followUpContext(lead(), 3)).toMatch(/OSTATNIA próba/);
  });

  it("podpis imieniem, gdy ustawione; inaczej bez imienia", () => {
    expect(followUpContext(lead(), 1)).toMatch(/Podpisz się imieniem: Marcin/);
    store.setSettings({ userName: "Sir" });
    expect(followUpContext(lead(), 1)).toMatch(/bez imienia/);
  });
});
