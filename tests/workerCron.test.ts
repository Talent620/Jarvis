import { describe, it, expect, vi } from "vitest";
vi.mock("cloudflare:sockets", () => ({ connect: () => ({}) }));
import {
  buildMorningBriefing,
  collectBriefingEvents,
  handleScheduled,
  shouldSendBriefing,
} from "../proxy/worker.js";

describe("proaktywny Cron Trigger (proxy/lib/cron.js)", () => {
  const NOW = Date.parse("2026-11-24T06:00:00Z");

  it("zwraca puste zdarzenia i NIE generuje briefingu, gdy brak istotnych spraw (zero spamu)", () => {
    const events = collectBriefingEvents(
      {
        calendar: [{ title: "Za tydzień", start: "2026-12-01T10:00:00Z" }],
        tasks: [{ title: "Zrobione", done: true, priority: true }],
        reminders: [{ text: "Stare", at: "2026-11-24T08:00:00Z", fired: true }],
        leads: [],
      },
      NOW,
    );
    expect(events).toEqual([]);
    expect(shouldSendBriefing(events)).toBe(false);
    expect(buildMorningBriefing(events, NOW)).toBeNull();
  });

  it("wyłuskuje spotkania <24h, pilne zadania, przypomnienia i zaległe follow-upy", () => {
    const events = collectBriefingEvents(
      {
        calendar: [{ title: "Spotkanie z klientem", start: "2026-11-24T09:00:00Z" }],
        tasks: [{ title: "Wystawić fakturę", done: false, priority: true }],
        reminders: [{ text: "Zadzwonić do Marka", at: "2026-11-24T11:00:00Z", fired: false }],
        leads: [{ company: "ABC Sp. z o.o.", status: "contacted", nextFollowUpAt: NOW - 1000 }],
      },
      NOW,
    );
    expect(events).toHaveLength(4);
    const b = buildMorningBriefing(events, NOW);
    expect(b?.summary).toContain("Spotkanie z klientem");
    expect(b?.summary).toContain("Wystawić fakturę");
    expect(b?.summary).toContain("Follow-up: ABC Sp. z o.o.");
  });

  it("handleScheduled zapisuje briefing do KV tylko dla kont z realnymi zdarzeniami", async () => {
    const kvData = new Map<string, string>([
      ["sync:quiet_user", JSON.stringify({ data: { tasks: [], calendar: [] } })],
      [
        "sync:busy_user",
        JSON.stringify({ data: { tasks: [{ title: "Pilny raport", done: false, priority: true }] } }),
      ],
    ]);
    const env = {
      JARVIS_KV: {
        list: vi.fn(async () => ({ keys: [...kvData.keys()].map((name) => ({ name })) })),
        get: vi.fn(async (k: string) => kvData.get(k) ?? null),
        put: vi.fn(async (k: string, v: string) => { kvData.set(k, v); }),
      },
    };

    const res = await handleScheduled({ scheduledTime: NOW }, env);
    expect(res).toMatchObject({ generated: 1, skipped: 1 });
    expect(kvData.has("briefing:busy_user")).toBe(true);
    expect(kvData.has("briefing:quiet_user")).toBe(false);
  });
});
