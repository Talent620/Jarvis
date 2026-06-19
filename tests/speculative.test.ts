import { describe, it, expect, vi } from "vitest";
import { divergence, shouldCorrect, speculativeAnswer } from "../src/lib/speculative";
import type { JarvisReply } from "../src/lib/providers/types";

const reply = (text: string): JarvisReply => ({ text, tools: [] });

describe("speculative — divergence", () => {
  it("identyczna treść → 0", () => {
    expect(divergence("Warszawa jest stolicą Polski", "Warszawa jest stolicą Polski")).toBe(0);
  });
  it("rozłączna treść → blisko 1", () => {
    expect(divergence("kompilator języka programowania", "przepis na ciasto marchewkowe")).toBeGreaterThan(0.8);
  });
  it("parafraza → niska rozbieżność", () => {
    expect(divergence("Stolicą Polski jest Warszawa", "Warszawa to stolica Polski")).toBeLessThan(0.5);
  });
});

describe("speculative — shouldCorrect", () => {
  it("pusty draft → zawsze korekta", () => {
    expect(shouldCorrect("", "cokolwiek konkretnego", 0.5)).toBe(true);
  });
  it("zgodne → bez korekty", () => {
    expect(shouldCorrect("Warszawa to stolica Polski", "Stolicą Polski jest Warszawa", 0.5)).toBe(false);
  });
  it("rozbieżne → korekta", () => {
    expect(shouldCorrect("odpowiedź A o kotach", "zupełnie inna B o samochodach silnikach", 0.5)).toBe(true);
  });
  it("draft zbyt krótki/stopwordowy (zero tokenów) → korekta z Kory", () => {
    // „Nie"/„Ok" → zero tokenów (stop-word / <3 znaki). Bez poprawki dawały divergence 0 = „zgodne"
    // i zostawiały draft; teraz, gdy draftu nie da się porównać, ufamy Korze (poprawność > oszczędność).
    expect(shouldCorrect("Nie.", "Ok.", 0.5)).toBe(true);
    expect(shouldCorrect("Ok", "Nie", 0.5)).toBe(true);
  });
});

describe("speculative — speculativeAnswer (orkiestracja)", () => {
  it("zgodny draft → zostaje lokalny (via ollama), bez korekty", async () => {
    const res = await speculativeAnswer({
      runLocal: async () => reply("Stolicą Polski jest Warszawa"),
      runCortex: async () => reply("Warszawa to stolica Polski"),
    });
    expect(res.corrected).toBe(false);
    expect(res.usedCortex).toBe(true);
    expect(res.reply.via).toBe("ollama");
  });

  it("rozbieżny draft → korekta Kory", async () => {
    const onToken = vi.fn();
    const res = await speculativeAnswer({
      runLocal: async () => reply("krótka błędna lokalna o kotach"),
      runCortex: async () => reply("poprawna obszerna odpowiedź o silnikach spalinowych i turbosprężarkach"),
      onToken,
    });
    expect(res.corrected).toBe(true);
    expect(res.reply.text).toMatch(/silnikach/);
    expect(onToken).toHaveBeenLastCalledWith(expect.stringMatching(/silnikach/));
  });

  it("Kora pada → draft lokalny finalny (graceful)", async () => {
    const res = await speculativeAnswer({
      runLocal: async () => reply("lokalna odpowiedź"),
      runCortex: async () => { throw new Error("timeout chmury"); },
    });
    expect(res.usedCortex).toBe(false);
    expect(res.corrected).toBe(false);
    expect(res.reply.text).toBe("lokalna odpowiedź");
  });

  it("lokalny pada, Kora ok → korekta Kory", async () => {
    const res = await speculativeAnswer({
      runLocal: async () => { throw new Error("ollama offline"); },
      runCortex: async () => reply("odpowiedź z chmury"),
    });
    expect(res.corrected).toBe(true);
    expect(res.reply.text).toBe("odpowiedź z chmury");
  });
});
