import { describe, it, expect } from "vitest";
import { conversationToMarkdown } from "../src/lib/exportChat";

describe("conversationToMarkdown — eksport rozmowy", () => {
  it("składa schludny Markdown z rolami", () => {
    const md = conversationToMarkdown([
      { role: "user", text: "Cześć" },
      { role: "assistant", text: "Witaj! Jak mogę pomóc?" },
    ], "Test");
    expect(md).toMatch(/^# Test/);
    expect(md).toMatch(/🧑 \*\*Ty\*\*/);
    expect(md).toMatch(/🤖 \*\*JARVIS\*\*/);
    expect(md).toMatch(/Witaj! Jak mogę pomóc\?/);
  });

  it("pomija puste wiadomości", () => {
    const md = conversationToMarkdown([
      { role: "user", text: "  " },
      { role: "assistant", text: "ok" },
    ]);
    expect((md.match(/Ty/g) || []).length).toBe(0);
    expect(md).toMatch(/ok/);
  });

  it("pusta rozmowa → adnotacja", () => {
    expect(conversationToMarkdown([])).toMatch(/pusta rozmowa/);
  });
});
