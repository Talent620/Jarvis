// Mission 5.x overlay "numerki przy dwuznaczności" (B-029): a described reference ("komentarz od
// Ani", "komentarz o Łodzi") that matches several items gets numbered badges and a short
// question; the answer picks one, then the usual verified focus runs.
import { describe, it, expect } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime, type Speaker } from "../../src/lib/runtime/lanes/runtime";
import { matchesDescription, parseReference } from "../../src/lib/runtime/polish";
import { pickNumbered } from "../../src/lib/runtime/session";
import { MemoryBrowser } from "../helpers/memoryBrowser";

const waitFor = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

async function setup(opts: ConstructorParameters<typeof MemoryBrowser>[0] = {}) {
  const env = new MemoryBrowser(opts);
  const kernel = new Kernel();
  const said: string[] = [];
  const speaker: Speaker = { say: (t) => { said.push(t); }, cancel: () => undefined };
  const rt = new JarvisRuntime({ kernel, env, speaker, session: { youtubeUrl: "http://yt.test/", answerTimeoutMs: 400 } });
  await rt.start();
  for (const t of ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Znajdź komentarze."]) rt.onText(t);
  await rt.idle();
  return { env, kernel, rt, said };
}

describe("described references", () => {
  it("parses author and topic, never on ordinals", () => {
    expect(parseReference("komentarz od Ani")).toMatchObject({ noun: "comment", author: "ani" });
    expect(parseReference("Pokaż komentarz od @LodzTV.")).toMatchObject({ author: "lodztv" });
    expect(parseReference("komentarz o Łodzi")).toMatchObject({ noun: "comment", about: "lodzi" });
    expect(parseReference("ten komentarz na temat Piotrkowskiej")).toMatchObject({ about: "piotrkowskiej" });
    expect(parseReference("pierwszy komentarz o Łodzi").about).toBeUndefined();
    expect(parseReference("wyślij to mailem Marcinowi").author).toBeUndefined();
  });

  it("matches inflected Polish words and authors", () => {
    expect(matchesDescription({ about: "lodzi" }, { text: "2024 był dobrym rokiem dla Łodzi" })).toBe(true);
    expect(matchesDescription({ about: "lodzi" }, { text: "Łódź to miasto" })).toBe(true);
    expect(matchesDescription({ about: "piotrkowskiej" }, { text: "przeszedł Piotrkowską w korku" })).toBe(true);
    expect(matchesDescription({ about: "manufakturze" }, { text: "ujęcia Bałut" })).toBe(false);
    expect(matchesDescription({ author: "ani" }, { author: "@ania" })).toBe(true);
    expect(matchesDescription({ author: "ani" }, { author: "@anatol" })).toBe(false);
    expect(matchesDescription({}, { text: "x" })).toBe(false);
  });

  it("picks a numbered candidate from Polish answers", () => {
    const c = [{ metadata: { author: "@LodzTV" } }, { metadata: { author: "@piotr" } }, { metadata: { author: "@ania" } }];
    expect(pickNumbered("drugi", c)).toBe(c[1]);
    expect(pickNumbered("numer 3", c)).toBe(c[2]);
    expect(pickNumbered("dwójka", c)).toBe(c[1]);
    expect(pickNumbered("ten od Piotra", c)).toBe(c[1]);
    expect(pickNumbered("piąty", c)).toBeNull();
    expect(pickNumbered("a jaka jutro pogoda?", c)).toBeNull();
  });
});

describe("ambiguity in the runtime", () => {
  it("one match is focused directly; several get badges and 'który?', the answer is verified", async () => {
    const { env, kernel, rt, said } = await setup();
    const one = rt.onText("Pokaż komentarz od Ani.");
    await rt.idle();
    expect(one.result?.truth).toBe("CONFIRMED");
    expect(env.highlight).toBe("yt-comment:c4");
    expect(env.marks).toEqual([]);

    const many = rt.onText("Pokaż komentarz o Łodzi.");
    await waitFor(() => rt.session.hasPendingQuestion());
    expect(env.marks).toEqual([{ ref: "yt-comment:c1", label: "1" }, { ref: "yt-comment:c8", label: "2" }]);
    const question = said.at(-1)!;
    expect(question).toMatch(/^Pasuje 2\. Oznaczyłem je numerami\. 1: od @LodzTV, „Łódź to miasto/);
    expect(question).toMatch(/2: od @piotr, „2024 był dobrym rokiem dla Ł.*”\. Który\?$/);
    expect(Object.values(kernel.state.tasks).at(-1)?.status).toBe("waiting_consent");
    expect(rt.claims("drugi", () => false)).toBe(true);
    const answer = rt.onText("drugi");
    expect(answer.route).toBe("answer");
    await rt.idle();
    expect(many.result?.truth).toBe("CONFIRMED");
    expect(env.highlight).toBe("yt-comment:c8");
    expect(env.marks).toEqual([]); // badges removed after the answer
    expect(many.say).toMatch(/^Ósmy komentarz, od @piotr/);
    // The cursor moved: "następny" continues from the chosen one.
    const next = rt.onText("następny");
    await rt.idle();
    expect(next.result?.truth).toBe("CONFIRMED");
    expect(env.highlight).toBe("yt-comment:c9");
  });

  it("no badges without the capability, and the question does not claim them; 'nie' leaves it", async () => {
    const { env, rt, said } = await setup({ noOverlay: true });
    const t = rt.onText("Pokaż komentarz o Piotrkowskiej.");
    await waitFor(() => rt.session.hasPendingQuestion());
    expect(said.at(-1)).toMatch(/^Pasuje 2\. 1: od @ania/);
    expect(said.at(-1)).not.toContain("Oznaczyłem");
    rt.onText("nie");
    await rt.idle();
    expect(t.result?.truth).toBe("BLOCKED");
    expect(t.say).toBe("Dobrze, zostawiam.");
    expect(env.highlight).toBeNull();
  });

  it("no answer in time: the task ends honestly and the badges are removed", async () => {
    const { env, rt } = await setup();
    const t = rt.onText("Pokaż komentarz o Łodzi.");
    await rt.idle();
    expect(t.result?.truth).toBe("BLOCKED");
    expect(env.marks).toEqual([]);
    expect(rt.session.hasPendingQuestion()).toBe(false);
  });

  it("'stop' while asking cancels the task in silence and clears the badges", async () => {
    const { env, kernel, rt, said } = await setup();
    rt.onText("Pokaż komentarz o Łodzi.");
    await waitFor(() => rt.session.hasPendingQuestion());
    const asked = said.length;
    rt.onText("stop");
    await rt.idle();
    expect(Object.values(kernel.state.tasks).at(-1)?.status).toBe("cancelled");
    expect(said.slice(asked)).toEqual([]);
    expect(env.marks).toEqual([]);
    expect(env.highlight).toBeNull();
  });
});
