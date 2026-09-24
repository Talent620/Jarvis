import { describe, it, expect } from "vitest";
import { classifyReflex, tier0FromPartial } from "../../src/lib/runtime/lanes/reflex";
import { isStatusQuestion, statusReply } from "../../src/lib/runtime/lanes/conversation";
import { Kernel } from "../../src/lib/runtime/kernel";

const ctl = (t: string) => { const r = classifyReflex(t); return r.kind === "control" ? `${r.control}/${r.tier}` : r.kind === "action" ? `action:${r.command.type}` : "none"; };

describe("reflex grammar (Polish, no LLM)", () => {
  it.each([
    ["stop", "stop/0"], ["Stop!", "stop/0"], ["stój", "stop/0"], ["przestań", "stop/0"], ["przerwij", "stop/0"],
    ["nie, stop", "stop/0"], ["zatrzymaj się", "stop/0"], ["dość", "stop/0"], ["anuluj", "stop/0"], ["stop stop", "stop/0"],
    ["poczekaj", "pause/0"], ["czekaj", "pause/0"], ["poczekaj chwilę", "pause/0"], ["chwila", "pause/0"], ["moment", "pause/0"],
    ["pauza", "pause/0"], ["wstrzymaj", "pause/0"], ["zaczekaj sekundę", "pause/0"],
    ["wznów", "resume/1"], ["kontynuuj", "resume/1"], ["dobra, rób dalej", "resume/1"], ["możesz kontynuować", "resume/1"],
    ["cofnij", "undo/1"], ["cofnij to", "undo/1"], ["nie, cofnij", "undo/1"],
    ["tak", "confirm/2"], ["tak, wyślij", "confirm/2"], ["potwierdzam", "confirm/2"], ["nie", "reject/2"], ["nie wysyłaj", "reject/2"],
    ["dalej", "next/1"],
    ["możesz zjechać?", "action:scroll"], ["zjedź no", "action:scroll"], ["zjedź trochę niżej", "action:scroll"],
    ["jeszcze bardziej w dół", "action:scroll"], ["wyżej", "action:scroll"],
    ["następny", "action:focusItem"], ["kolejny", "action:focusItem"], ["poprzedni", "action:focusItem"], ["nie ten, następny", "action:focusItem"],
    ["kopiuj", "action:copy"], ["skopiuj", "action:copy"],
    ["a jaka jutro pogoda?", "none"], ["co sądzisz o tym filmie?", "none"],
  ])("%s -> %s", (text, want) => {
    expect(ctl(text)).toBe(want);
  });

  it("a control word inside a longer sentence is not a bare control", () => {
    expect(ctl("nie zatrzymuj się na tym filmie, puść następny")).not.toBe("stop/0");
    expect(ctl("powiedz mi, czy stop jest dobrym słowem")).toBe("none");
  });

  it("tier 0 on a partial needs user speech, stability and a short utterance", () => {
    expect(tier0FromPartial("stop", 0.9, true)).toBe("stop");
    expect(tier0FromPartial("stop", 0.9, false)).toBeNull(); // TTS echo
    expect(tier0FromPartial("stop", 0.4, true)).toBeNull(); // unstable
    expect(tier0FromPartial("poczekaj chwilę", 0.8, true)).toBe("pause");
    expect(tier0FromPartial("zjedź niżej", 0.99, true)).toBeNull(); // tier 1 never runs on a partial
    expect(tier0FromPartial("tak wyślij", 0.99, true)).toBeNull(); // tier 2 never runs on a partial
    expect(tier0FromPartial("stop to wszystko co chciałem powiedzieć", 0.99, true)).toBeNull();
  });
});

describe("status questions", () => {
  it.each(["co teraz robisz?", "Co robisz?", "na czym stoimy", "co się dzieje?", "czym się zajmujesz"])("%s", (t) => {
    expect(isStatusQuestion(t)).toBe(true);
  });

  it("reports paused and waiting tasks honestly", () => {
    const k = new Kernel();
    k.dispatch({ type: "TaskCreated", taskId: "A", goal: "Znajdź komentarze.", kind: "findCollection" });
    k.dispatch({ type: "ControlIntent", control: "pause", tier: 0 });
    expect(statusReply(k.state)).toBe("Mam: „Znajdź komentarze.”, wstrzymane.");
    k.dispatch({ type: "ConsentRequested", consentId: "c", taskId: "A", summary: "x", args: {} });
    expect(statusReply(k.state, ["Skopiuj."])).toContain("W kolejce: „Skopiuj.”");
  });
});
