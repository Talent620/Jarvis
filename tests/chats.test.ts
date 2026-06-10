import { describe, it, expect } from "vitest";
import { stripImages, titleFrom, type ChatSession } from "../src/lib/chats";

const img = { data: "AAAA", mediaType: "image/png" };
const session = (id: string, withImg: boolean): ChatSession => ({
  id,
  title: id,
  updatedAt: Number(id),
  messages: [
    { id: "u", role: "user", text: "cześć", image: withImg ? img : undefined, createdAt: 1 },
    { id: "a", role: "assistant", text: "hej", createdAt: 2 },
  ],
});

describe("stripImages (ochrona limitu localStorage)", () => {
  it("zachowuje obrazy w N najnowszych sesjach, usuwa w starszych", () => {
    const list = [session("3", true), session("2", true), session("1", true)];
    const out = stripImages(list, 1);
    expect(out[0].messages[0].image).toBeDefined(); // najnowsza — obraz zostaje
    expect(out[1].messages[0].image).toBeUndefined(); // starsza — usunięty
    expect(out[2].messages[0].image).toBeUndefined();
  });

  it("wstawia znacznik tekstowy, gdy wiadomość była tylko obrazem", () => {
    const s: ChatSession = {
      id: "1", title: "1", updatedAt: 1,
      messages: [{ id: "u", role: "user", text: "", image: img, createdAt: 1 }],
    };
    const out = stripImages([s], 0);
    expect(out[0].messages[0].image).toBeUndefined();
    expect(out[0].messages[0].text).toContain("zdjęcie");
  });

  it("keepFirst=0 usuwa obrazy ze wszystkich", () => {
    const out = stripImages([session("2", true), session("1", true)], 0);
    expect(out.every((c) => c.messages.every((m) => !m.image))).toBe(true);
  });
});

describe("titleFrom", () => {
  it("bierze pierwszą wiadomość użytkownika (skrócona)", () => {
    expect(titleFrom([{ id: "a", role: "assistant", text: "x", createdAt: 1 }, { id: "u", role: "user", text: "kup mleko", createdAt: 2 }])).toBe("kup mleko");
  });
  it("domyślny tytuł, gdy brak wiadomości użytkownika", () => {
    expect(titleFrom([])).toBe("Rozmowa");
  });
});
