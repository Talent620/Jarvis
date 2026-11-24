import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_LIVE_VISION_QUESTION,
  LIVE_VISION_SYSTEM_PROMPT,
  parseLiveVisionCommand,
  runLiveVision,
} from "../src/lib/liveVision";
import {
  isHeavyMission,
  parseBackgroundMissionCommand,
  reflexConfirmationFor,
  MissionQueue,
} from "../src/lib/missionQueue";

describe("Sprint 2 / Moduł 4 — Live Vision ('Oczy w terenie') + Kolejka Misji w Tle (mission_queue)", () => {
  describe("Live Vision ('Pokaż Jarvisowi' / 'popatrz na to')", () => {
    it("rozpoznaje komendę głosową 'popatrz na to' z pytaniem lub bez", () => {
      const bare = parseLiveVisionCommand("Popatrz na to");
      expect(bare.matched).toBe(true);
      expect(bare.question).toBe(DEFAULT_LIVE_VISION_QUESTION);

      const withQ = parseLiveVisionCommand("Jarvis, popatrz na to: co to za błąd na falowniku?");
      expect(withQ.matched).toBe(true);
      expect(withQ.question).toBe("co to za błąd na falowniku?");

      const show = parseLiveVisionCommand("Pokaż Jarvisowi czy ten kabel jest dobrze wpięty");
      expect(show.matched).toBe(true);
      expect(show.question).toContain("kabel");

      expect(parseLiveVisionCommand("Włącz światło w salonie").matched).toBe(false);
    });

    it("przechwytuje skompresowaną klatkę tylnej kamery i zwraca krótką instrukcję głosową", async () => {
      const fakeImg = { data: "ZmFrZV9qcGVn", mediaType: "image/jpeg" };
      const askSpy = vi.fn(async (history, extraSystem) => {
        expect(history[0].image).toEqual(fakeImg);
        expect(extraSystem).toBe(LIVE_VISION_SYSTEM_PROMPT);
        return {
          text: "- **Widzę** bezpiecznik B16 w pozycji wyłączonej.\n- Podnieś dźwignię do góry.\n- Sprawdź https://example.com.\n- Czwarte zdanie zbędne.",
          via: "gemini" as const,
        };
      });

      const res = await runLiveVision("Co wybiło w rozdzielnicy?", {
        capture: async () => fakeImg,
        ask: askSpy,
      });

      expect(askSpy).toHaveBeenCalledTimes(1);
      expect(res).not.toBeNull();
      expect(res!.image).toEqual(fakeImg);
      expect(res!.spokenText).not.toContain("**");
      expect(res!.spokenText).not.toContain("https://");
      expect(res!.spokenText).not.toContain("Czwarte zdanie");
      expect(res!.spokenText).toContain("bezpiecznik B16");
    });

    it("zwraca null, gdy użytkownik anuluje aparat", async () => {
      const res = await runLiveVision("Sprawdź to", { capture: async () => null });
      expect(res).toBeNull();
    });
  });

  describe("Kolejka Misji w Tle (mission_queue)", () => {
    it("klasyfikuje ciężkie zapytania i parsuje komendy 'w tle:'", () => {
      expect(isHeavyMission("Zrób głęboki research konkurencji w fotowoltaice")).toEqual({
        heavy: true,
        kind: "research",
      });
      expect(isHeavyMission("Przeanalizuj umowę najmu PDF")).toEqual({
        heavy: true,
        kind: "document",
      });
      expect(isHeavyMission("Narada: wejście w Niemcy")).toEqual({
        heavy: true,
        kind: "narada",
      });
      expect(isHeavyMission("Która godzina?")).toEqual({ heavy: false, kind: "general" });

      expect(parseBackgroundMissionCommand("W tle: zbadaj ceny serwerów H100")).toEqual({
        kind: "general",
        prompt: "zbadaj ceny serwerów H100",
      });
      expect(parseBackgroundMissionCommand("Narada w tle: leasing auta")).toEqual({
        kind: "narada",
        prompt: "leasing auta",
      });
      expect(parseBackgroundMissionCommand("Zbadaj w tle rynek pomp ciepła")).toEqual({
        kind: "research",
        prompt: "rynek pomp ciepła",
      });
    });

    it("natychmiast zwraca potwierdzenie Refleks i kończy asynchronicznie z powiadomieniem + kartą akcji", async () => {
      const notifications: Array<{ title: string; body: string }> = [];
      const queue = new MissionQueue({
        persist: false,
        notifier: async (title, body) => {
          notifications.push({ title, body });
        },
      });

      let resolveWork!: (v: { text: string }) => void;
      const workPromise = new Promise<{ text: string }>((r) => {
        resolveWork = r;
      });
      const donePromise = new Promise<void>((resolve) => {
        const queued = queue.enqueue({
          kind: "research",
          title: "Analiza konkurencji",
          prompt: "Zbadaj rynek pomp ciepła",
          runner: () => workPromise,
          onDone: () => resolve(),
        });

        // Natychmiastowa odpowiedź Refleks zanim zadanie się zakończy!
        expect(queued.status).toBe("queued");
        expect(queued.reflexAck).toBe(reflexConfirmationFor("research", "Analiza konkurencji"));
        expect(queued.reflexAck).toContain("Przyjąłem research w tle");
      });

      // Praca w tle kończy się asynchronicznie
      resolveWork({ text: "Znalazłem 3 liderów rynku z marżą 28%. Rekomenduję wejście w serwis." });
      await donePromise;

      const list = queue.list();
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe("done");
      expect(list[0].resultText).toContain("3 liderów rynku");
      expect(list[0].spokenSummary).toContain("3 liderów rynku");
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toContain("Analiza konkurencji");

      queue.dismiss(list[0].id);
      expect(queue.list()).toHaveLength(0);
    });
  });
});
