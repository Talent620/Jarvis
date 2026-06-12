import { describe, it, expect } from "vitest";
import { buildContext, isSystemMessage } from "../src/lib/context";
import type { ChatMessage } from "../src/types";

const msg = (role: "user" | "assistant", text: string, tools?: string[]): ChatMessage => ({
  id: Math.random().toString(36).slice(2), role, text, tools, createdAt: Date.now(),
});

describe("okno kontekstu rozmowy", () => {
  it("rozpoznaje komunikaty systemowe (powitanie, przypomnienie, briefing…)", () => {
    expect(isSystemMessage(msg("assistant", "Dzień dobry", ["proactive"]))).toBe(true);
    expect(isSystemMessage(msg("assistant", "Przypomnienie…", ["reminder"]))).toBe(true);
    expect(isSystemMessage(msg("assistant", "Tak? Słucham.", ["wake"]))).toBe(true);
    expect(isSystemMessage(msg("assistant", "Dodałem zadanie", ["add_task"]))).toBe(false); // realna odpowiedź
    expect(isSystemMessage(msg("user", "cokolwiek"))).toBe(false);
  });

  it("z historii wycina komunikaty systemowe, zostawia czysty dialog", () => {
    const history: ChatMessage[] = [
      msg("assistant", "Dzień dobry, w czym pomóc?", ["proactive"]),
      msg("user", "Mam na imię Marcin"),
      msg("assistant", "Miło Cię poznać, Marcin."),
      msg("assistant", "Przypomnienie: spotkanie", ["reminder"]),
      msg("user", "Jak mam na imię?"),
    ];
    const ctx = buildContext(history, 30);
    expect(ctx.map((c) => c.content)).toEqual([
      "Mam na imię Marcin",
      "Miło Cię poznać, Marcin.",
      "Jak mam na imię?",
    ]);
  });

  it("przycina do ostatnich N wiadomości (po odfiltrowaniu)", () => {
    const many: ChatMessage[] = Array.from({ length: 50 }, (_, i) => msg(i % 2 ? "assistant" : "user", `wiadomość ${i}`));
    const ctx = buildContext(many, 30);
    expect(ctx.length).toBe(30);
    expect(ctx[ctx.length - 1].content).toBe("wiadomość 49");
  });

  it("zachowuje obraz w ostatniej wiadomości", () => {
    const m = msg("user", "co to?");
    (m as any).image = { data: "AAA", mediaType: "image/png" };
    const ctx = buildContext([m], 30);
    expect(ctx[0].image?.data).toBe("AAA");
  });
});
