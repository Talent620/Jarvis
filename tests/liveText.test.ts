import { describe, it, expect } from "vitest";
import { cleanLiveText } from "../src/lib/liveVoice";

// Filtr napisów rozmowy na żywo: model Live nie powinien pokazywać surowych
// pseudo-wywołań narzędzi (tool_code / default_api) — to defekt widoczny na ekranie.
describe("cleanLiveText — czyszczenie napisów live z wycieków tool_code", () => {
  it("usuwa print(default_api.gmail_search(...)) z dymka", () => {
    const out = cleanLiveText("tool_code print(default_api.gmail_search(query='is:unread'))");
    expect(out).not.toMatch(/default_api|tool_code|print\(/);
  });

  it("wycina blok ```tool_code ... ```", () => {
    const out = cleanLiveText("Sprawdzam.\n```tool_code\nprint(default_api.gcal_list())\n```\nGotowe.");
    expect(out).not.toMatch(/default_api|tool_code|```/);
    expect(out).toMatch(/Sprawdzam/);
    expect(out).toMatch(/Gotowe/);
  });

  it("zostawia normalną wypowiedź nietkniętą", () => {
    const txt = "Masz jutro spotkanie o 10:00 z klientem.";
    expect(cleanLiveText(txt)).toBe(txt);
  });

  it("usuwa gołe wywołanie default_api.foo(...) w zdaniu", () => {
    const out = cleanLiveText("Już sprawdzam default_api.gcal_list() dla Ciebie.");
    expect(out).not.toMatch(/default_api/);
    expect(out).toMatch(/Już sprawdzam/);
  });

  it("pusty/niepełny input nie wywala się", () => {
    expect(cleanLiveText("")).toBe("");
    expect(cleanLiveText(undefined as unknown as string)).toBe("");
  });
});
