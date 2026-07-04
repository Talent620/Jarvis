// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  topicOf,
  keywords,
  topTopics,
  staleRecurringTopics,
  recordEpisode,
  loadEpisodes,
  clearEpisodes,
  type Episode,
} from "../src/lib/episodicMemory";

const DAY = 86_400_000;
const now = Date.now();

describe("episodicMemory — czyste funkcje", () => {
  it("topicOf skraca i czyści białe znaki", () => {
    expect(topicOf("  ala   ma\nkota  ")).toBe("ala ma kota");
    expect(topicOf("x".repeat(100)).length).toBe(80);
  });

  it("keywords pomija stopwords i krótkie słowa", () => {
    expect(keywords("Jak mam przygotować raporty?")).toEqual(["przygotować", "raporty"]);
  });

  it("topTopics liczy najczęstsze słowa-klucze w oknie", () => {
    const eps: Episode[] = [
      { at: now, kind: "chat", topic: "raporty kwartalne" },
      { at: now, kind: "chat", topic: "raporty sprzedaży" },
      { at: now, kind: "chat", topic: "budżet projektu" },
    ];
    const top = topTopics(eps, now - DAY, 3);
    expect(top[0]).toEqual({ word: "raporty", count: 2 });
  });

  it("staleRecurringTopics: częste w 30 dni, ale nie ostatnio", () => {
    const eps: Episode[] = [
      { at: now - 20 * DAY, kind: "chat", topic: "raporty A" },
      { at: now - 18 * DAY, kind: "chat", topic: "raporty B" },
      { at: now - 15 * DAY, kind: "chat", topic: "raporty C" },
      { at: now - 1 * 3600000, kind: "chat", topic: "pogoda" },
    ];
    expect(staleRecurringTopics(eps, now)).toContain("raporty");
    expect(staleRecurringTopics(eps, now)).not.toContain("pogoda");
  });
});

describe("episodicMemory — trwałość", () => {
  beforeEach(() => clearEpisodes());

  it("recordEpisode zapisuje (najnowsze pierwsze) i pomija pusty temat", () => {
    recordEpisode("chat", "pierwszy temat");
    recordEpisode("chat", "   ");
    recordEpisode("tool", "drugi temat");
    const all = loadEpisodes();
    expect(all).toHaveLength(2);
    expect(all[0].topic).toBe("drugi temat");
    expect(all[0].kind).toBe("tool");
  });
});
