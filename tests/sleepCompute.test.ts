import { describe, it, expect } from "vitest";
import {
  isQuietHours,
  normalizeProactiveBudget,
  canSendProactiveNudge,
  consumeProactiveBudget,
  extractUserLessonFromCorrection,
  mergeUserLessons,
  consolidateOpenLoops,
  sleepConsolidate,
  buildSleepMemoryPromptBlock,
} from "../src/lib/sleepCompute";
import { dueNotifications, type NotifyInput } from "../src/lib/proactiveNotify";
import {
  sleepConsolidate as workerSleepConsolidate,
  checkProactiveBudget as workerCheckBudget,
  handleScheduled,
} from "../proxy/lib/cron.js";
import type { OpenLoop } from "../src/types";

describe("Sprint 2 / Moduł 2 — Nocny Sen (Sleep-Time Compute) + Budżet Ciszy", () => {
  describe("Budżet Ciszy (max 3/dzień + cisza nocna 22:00–07:00)", () => {
    it("blokuje proaktywne zaczepki w godzinach ciszy nocnej 22:00–07:00", () => {
      const at22 = new Date("2026-06-20T22:15:00").getTime();
      const at03 = new Date("2026-06-21T03:30:00").getTime();
      const at0659 = new Date("2026-06-21T06:59:00").getTime();
      const at0700 = new Date("2026-06-21T07:00:00").getTime();
      const at2159 = new Date("2026-06-20T21:59:00").getTime();

      expect(isQuietHours(at22)).toBe(true);
      expect(isQuietHours(at03)).toBe(true);
      expect(isQuietHours(at0659)).toBe(true);
      expect(isQuietHours(at0700)).toBe(false);
      expect(isQuietHours(at2159)).toBe(false);

      expect(canSendProactiveNudge(undefined, at22)).toEqual({
        allowed: false,
        reason: "quiet_hours",
        remaining: 3,
      });
    });

    it("egzekwuje twardy limit 3 proaktywnych zaczepek dziennie i resetuje o północy", () => {
      const day1Noon = new Date("2026-06-20T12:00:00").getTime();
      const day2Noon = new Date("2026-06-21T12:00:00").getTime();

      let b = normalizeProactiveBudget(undefined, day1Noon);
      expect(canSendProactiveNudge(b, day1Noon)).toEqual({ allowed: true, reason: "ok", remaining: 3 });

      b = consumeProactiveBudget(b, day1Noon, 1);
      b = consumeProactiveBudget(b, day1Noon, 1);
      b = consumeProactiveBudget(b, day1Noon, 1);
      expect(b.usedToday).toBe(3);
      expect(canSendProactiveNudge(b, day1Noon)).toEqual({
        allowed: false,
        reason: "budget_exhausted",
        remaining: 0,
      });

      // Nowy dzień — automatyczny reset do pełnego limitu 3
      expect(canSendProactiveNudge(b, day2Noon)).toEqual({
        allowed: true,
        reason: "ok",
        remaining: 3,
      });
    });

    it("dueNotifications ucina powiadomienia do pozostałego Budżetu Ciszy i wycisza nocą", () => {
      const preds = Array.from({ length: 6 }, (_, i) => ({
        id: `p${i}`,
        kind: "reminder" as const,
        urgency: "high" as const,
        title: `Pilne ${i}`,
      }));
      const base: NotifyInput = {
        enabled: true,
        dailyBriefing: false,
        briefingTime: "08:00",
        briefingLine: "",
        predictions: preds,
        proactiveBudget: { date: "2026-06-20", usedToday: 1, dailyLimit: 3, quietStartHour: 22, quietEndHour: 7 },
      };

      const noon = new Date("2026-06-20T12:00:00").getTime();
      const night = new Date("2026-06-20T23:10:00").getTime();

      // Pozostały 2 z 3 → max 2 decyzje
      expect(dueNotifications(base, noon, new Set())).toHaveLength(2);
      // Cisza nocna 23:10 → 0 decyzji
      expect(dueNotifications(base, night, new Set())).toEqual([]);
    });
  });

  describe("user_lessons — reguły stylu z korekt i przerwania (barge-in)", () => {
    it("wyciąga regułę stylu z korekty 'za długo / konkretniej' oraz z barge-in", () => {
      const l1 = extractUserLessonFromCorrection("Za długo gadasz, mów krócej!");
      expect(l1?.rule).toContain("zwięźle");
      expect(l1?.source).toBe("correction");

      const l2 = extractUserLessonFromCorrection("Konkretniej, bez wstępów");
      expect(l2?.rule).toContain("Zero wstępów");

      const l3 = extractUserLessonFromCorrection("", { wasBargeIn: true });
      expect(l3?.source).toBe("barge_in");
      expect(l3?.rule).toContain("barge-in");
    });

    it("deduplikuje powtarzające się lekcje i zlicza hits", () => {
      const inc = extractUserLessonFromCorrection("Krócej proszę!")!;
      const m1 = mergeUserLessons([], [inc], 1000);
      const m2 = mergeUserLessons(m1, [inc], 2000);
      expect(m2).toHaveLength(1);
      expect(m2[0].hits).toBe(2);
    });
  });

  describe("open_loops + sleep_consolidate (klient i proxy Cron)", () => {
    it("wykrywa nowe open_loops, deduplikuje je, domyka załatwione i eskaluje po 48h", () => {
      const t0 = new Date("2026-06-18T10:00:00").getTime();
      const t48h = t0 + 49 * 3600_000;
      const existing: OpenLoop[] = [
        {
          id: "old1",
          topic: "wysłać wycenę dla klienta Kowalski",
          promise: "wyślę wycenę dla klienta Kowalski",
          priority: "medium",
          status: "open",
          createdAt: t0,
          updatedAt: t0,
        },
        {
          id: "old2",
          topic: "sprawdzić fakturę za serwer",
          promise: "muszę sprawdzić fakturę za serwer",
          priority: "medium",
          status: "open",
          createdAt: t0,
          updatedAt: t0,
        },
      ];

      const consolidated = consolidateOpenLoops(
        existing,
        [
          { role: "user", content: "Sprawa z fakturę za serwer załatwione i wysłane.", createdAt: t48h },
          { role: "user", content: "Muszę jutro pilnie podpisać umowę z operatorem.", createdAt: t48h },
        ],
        t48h,
      );

      const old1 = consolidated.find((l) => l.id === "old1");
      const old2 = consolidated.find((l) => l.id === "old2");
      const added = consolidated.find((l) => l.topic.includes("podpisać umowę"));

      expect(old1?.priority).toBe("high"); // eskalacja po >48h
      expect(old2?.status).toBe("closed"); // domknięte słowem „załatwione”
      expect(added?.status).toBe("open");
      expect(added?.priority).toBe("high");
    });

    it("sleepConsolidate przygotowuje briefing głosowy <=30 s TYLKO gdy istnieje pilny powód", () => {
      const morning = new Date("2026-06-20T07:30:00").getTime();
      const calm = sleepConsolidate({ messages: [{ role: "user", content: "Miłego wieczoru" }], now: morning });
      expect(calm.urgent).toBe(false);
      expect(calm.spokenBriefing).toBeNull();

      const urgent = sleepConsolidate({
        messages: [
          { role: "user", content: "Obiecałem jutro pilnie wysłać ofertę do firmy Alfa." },
          { role: "user", content: "Za długo, mów krócej." },
        ],
        now: morning,
      });
      expect(urgent.urgent).toBe(true);
      expect(urgent.spokenBriefing).toBeTruthy();
      expect(urgent.spokenBriefing!.length).toBeLessThan(350);
      expect(urgent.user_lessons).toHaveLength(1);
      expect(buildSleepMemoryPromptBlock(urgent.open_loops, urgent.user_lessons)).toContain("open_loops");
    });

    it("proxy/lib/cron.js wykonuje nocną konsolidację i respektuje Budżet Ciszy", async () => {
      const morningUtc = Date.parse("2026-06-20T08:00:00Z");
      const nightUtc = Date.parse("2026-06-20T23:00:00Z");

      expect(workerCheckBudget({ date: "2026-06-20", usedToday: 0, dailyLimit: 3 }, nightUtc).allowed).toBe(false);
      expect(workerCheckBudget({ date: "2026-06-20", usedToday: 3, dailyLimit: 3 }, morningUtc).allowed).toBe(false);

      const sleepRes = workerSleepConsolidate(
        {
          recentMessages: [
            { role: "user", content: "Muszę pilnie opłacić fakturę za domenę dzisiaj." },
            { role: "user", content: "Konkretniej proszę." },
          ],
        },
        morningUtc,
      );
      expect(sleepRes.urgent).toBe(true);
      expect(sleepRes.open_loops.length).toBe(1);
      expect(sleepRes.user_lessons.length).toBe(1);
      expect(sleepRes.spokenBriefing).toContain("pilne");

      // Symulacja KV w handleScheduled
      const kvStore = new Map<string, string>();
      kvStore.set(
        "sync:tok1",
        JSON.stringify({
          data: {
            recentMessages: [{ role: "user", content: "Muszę pilnie oddzwonić do klienta dziś." }],
          },
        }),
      );
      kvStore.set("sync:tok_quiet", JSON.stringify({ data: { tasks: [] } }));
      const env = {
        JARVIS_KV: {
          list: async () => ({ keys: [{ name: "sync:tok1" }, { name: "sync:tok_quiet" }] }),
          get: async (k: string) => kvStore.get(k) ?? null,
          put: async (k: string, v: string) => { kvStore.set(k, v); },
        },
      };
      const stats = await handleScheduled({ scheduledTime: morningUtc }, env);
      expect(stats.consolidated).toBe(2);
      expect(stats.generated).toBe(1);
      expect(stats.skipped).toBe(1);
      expect(kvStore.has("sleep:tok1")).toBe(true);
      expect(kvStore.has("briefing:tok1")).toBe(true);
      expect(kvStore.has("briefing:tok_quiet")).toBe(false);
    });
  });
});
