// Mission M10: verified locator cache, escalation to vision, and the Skill Compiler, on the same
// runtime as production (Kernel + JarvisRuntime + ActionSession) with the in-memory YouTube and
// a mock Gmail. The vision model and the pointer are test doubles: no network, no paid calls.
import { describe, it, expect } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime, type RuntimeTurn, type Speaker } from "../../src/lib/runtime/lanes/runtime";
import { LocatorCache } from "../../src/lib/runtime/locatorCache";
import { EscalatingEnvironment, type Box, type Screen, type ScreenImage, type VisionModel } from "../../src/lib/runtime/env/vision";
import { SkillLibrary, parseRememberSkill, parseRunSkill, type Skill, type SkillStore } from "../../src/lib/runtime/skills";
import { normalizeUtterance } from "../../src/lib/runtime/util";
import type { Contact } from "../../src/lib/runtime/contacts";
import type { ActResult, ComputerEnvironment, EnvAction, ReadQuery, ReadResult } from "../../src/lib/runtime/env/types";
import type { CapabilityState } from "../../src/lib/runtime/types";
import { MemoryBrowser } from "../helpers/memoryBrowser";
import { MockMail } from "../helpers/mockMail";

const GOLDEN_1_7 = ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Zjedź trochę niżej.", "Znajdź komentarze.", "Pierwszy komentarz.", "Zaznacz pierwsze cztery litery.", "Skopiuj."];
const BOOK: Contact[] = [{ id: "m1", name: "Marcin Kubicki", emails: ["marcin.kubicki@example.com"], source: "fixture" }];

const waitFor = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

class MemoryStore implements SkillStore {
  data: unknown = [];
  load() { return this.data as Skill[]; }
  save(s: Skill[]) { this.data = JSON.parse(JSON.stringify(s)); }
}

/** MemoryBrowser whose semantic layer can be broken or made to fail, per action kind. */
class Flaky implements ComputerEnvironment {
  readonly id = "managed-browser";
  notFound = new Set<EnvAction["kind"]>();
  failing = new Set<EnvAction["kind"]>();
  caps?: CapabilityState[];
  constructor(readonly mem: MemoryBrowser) {}
  capabilities() { return this.caps ? Promise.resolve(this.caps) : this.mem.capabilities(); }
  act(a: EnvAction, s?: AbortSignal): Promise<ActResult> {
    if (this.notFound.has(a.kind)) return Promise.resolve({ status: "not_found", error: "semantic locator broken" });
    if (this.failing.has(a.kind)) return Promise.resolve({ status: "failed", error: "the page refused" });
    return this.mem.act(a, s);
  }
  read(q: ReadQuery): Promise<ReadResult> { return this.mem.read(q); }
  onEvent(l: Parameters<ComputerEnvironment["onEvent"]>[0]) { return this.mem.onEvent(l); }
  close() { return this.mem.close(); }
}

/**
 * A screen of the in-memory page: video i on the home page sits at y = 100 + 50 * i, 400 px
 * wide. A click does only what a real click on that spot does: follow the video link.
 */
class FakeScreen implements Screen {
  captures = 0;
  clicks: { x: number; y: number }[] = [];
  signature = "home@1280x800";
  constructor(private readonly mem: MemoryBrowser) {}
  async capture(): Promise<ScreenImage> {
    this.captures++;
    return { data: "png-bytes", width: 1280, height: 800, signature: this.signature };
  }
  async click(x: number, y: number): Promise<boolean> {
    this.clicks.push({ x, y });
    const i = Math.floor((y - 100) / 50);
    const items = (await this.mem.read({ kind: "collection", itemKind: "video" })) as { items: { ref: string; semanticKey?: string }[] };
    const hit = this.mem.page === "home" && x >= 0 && x <= 400 && i >= 0 ? items.items[i] : undefined;
    if (hit) await this.mem.act({ kind: "browser.open", target: { ref: hit.ref, semanticKey: hit.semanticKey } });
    return true;
  }
}
const videoBox = (i: number): Box => ({ x: 0, y: 100 + 50 * i, w: 400, h: 40 });

class FakeVision implements VisionModel {
  calls: string[] = [];
  constructor(private readonly answer: () => { found: boolean; box?: Box; confidence: number }) {}
  async locate(_img: ScreenImage, description: string) {
    this.calls.push(description);
    return this.answer();
  }
}

function runtime(env: ComputerEnvironment, o: { skills?: SkillLibrary; mail?: MockMail } = {}) {
  const said: string[] = [];
  const speaker: Speaker = { say: (t) => { said.push(t); }, cancel: () => undefined };
  const kernel = new Kernel();
  const rt = new JarvisRuntime({
    kernel, env, speaker, skills: o.skills,
    session: { youtubeUrl: "http://yt.test/", mail: o.mail, mailOptions: { timeoutMs: 40, recheckDelayMs: 5 }, contacts: async () => BOOK, answerTimeoutMs: 3000 },
  });
  return { rt, kernel, said };
}

async function run(rt: JarvisRuntime, texts: string[]) {
  const turns = texts.map((t) => rt.onText(t));
  await rt.idle();
  return turns;
}

const truths = (turns: RuntimeTurn[]) => turns.map((t) => t.result?.truth);

describe("LocatorCache", () => {
  it("keeps only verified locators and forgets them on age, a changed structure or failures", () => {
    let now = 1000;
    const c = new LocatorCache({ now: () => now, ttlMs: 10_000, maxFailures: 2 });
    c.recordVerified("youtube.com", "comment first", { strategy: "css", value: "#c1" }, "sig-a");
    expect(c.get("YouTube.com", "Comment  First", "sig-a")?.locator.value).toBe("#c1");
    expect(c.get("youtube.com", "comment first", "sig-b")).toBeNull(); // redesign: gone for good
    expect(c.get("youtube.com", "comment first", "sig-a")).toBeNull();

    c.recordVerified("youtube.com", "a", { strategy: "css", value: "#a" });
    c.recordFailure("youtube.com", "a");
    expect(c.get("youtube.com", "a")).not.toBeNull(); // one failure is tolerated for selectors
    c.recordFailure("youtube.com", "a");
    expect(c.get("youtube.com", "a")).toBeNull();

    c.recordVerified("youtube.com", "b", { strategy: "vision", value: "1,2,3,4" });
    c.recordFailure("youtube.com", "b");
    expect(c.get("youtube.com", "b")).toBeNull(); // coordinates die on the first failure

    c.recordVerified("youtube.com", "old", { strategy: "css", value: "#o" });
    now += 10_001;
    expect(c.get("youtube.com", "old")).toBeNull();
  });

  it("scope invalidation, bounded size, export and import of well-formed entries only", () => {
    const c = new LocatorCache({ maxEntries: 3 });
    for (const t of ["a", "b", "c", "d"]) c.recordVerified("site", t, { strategy: "semantic", value: t });
    expect(c.size).toBe(3);
    expect(c.get("site", "a")).toBeNull(); // oldest evicted
    const copy = new LocatorCache();
    copy.import([...c.export(), { scope: 5, target: null } as never]);
    expect(copy.size).toBe(3);
    expect(copy.invalidateScope("SITE")).toBe(3);
    expect(copy.size).toBe(0);
  });
});

describe("escalation: semantic, then verified cache, then vision, then not found", () => {
  const OPEN = GOLDEN_1_7.slice(0, 3);
  function broken(kind: EnvAction["kind"] = "browser.open") {
    const mem = new MemoryBrowser();
    const flaky = new Flaky(mem);
    flaky.notFound.add(kind);
    return { mem, flaky, screen: new FakeScreen(mem) };
  }
  async function start(env: ComputerEnvironment) {
    const { rt } = runtime(env);
    await rt.start();
    return rt;
  }

  it("V1 semantic works: vision is never asked and nothing is captured", async () => {
    const mem = new MemoryBrowser();
    const screen = new FakeScreen(mem);
    const vision = new FakeVision(() => ({ found: true, box: videoBox(0), confidence: 1 }));
    const rt = await start(new EscalatingEnvironment(new Flaky(mem), { cache: new LocatorCache(), vision, screen }));
    const turns = await run(rt, GOLDEN_1_7);
    expect(truths(turns)).toEqual(Array(8).fill("CONFIRMED"));
    expect(screen.captures).toBe(0);
    expect(vision.calls).toEqual([]);
  });

  it("V2 broken link locator: vision finds it, one click, CONFIRMED by the URL read-back, box cached and reused", async () => {
    const { mem, flaky, screen } = broken();
    const vision = new FakeVision(() => ({ found: true, box: videoBox(0), confidence: 0.92 }));
    const cache = new LocatorCache();
    const env = new EscalatingEnvironment(flaky, { cache, vision, screen });
    expect((await env.capabilities()).find((c) => c.id === "vision")?.status).toBe("available");
    const rt = await start(env);
    const turns = await run(rt, OPEN);
    expect(truths(turns)).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED"]);
    expect(mem.url).toBe("http://yt.test/watch?v=lodz");
    expect(screen.clicks).toHaveLength(1);
    expect(vision.calls).toEqual(["video video:/watch?v=lodz"]);
    expect(cache.export()).toEqual([expect.objectContaining({ scope: "yt.test", locator: { strategy: "vision", value: "0,100,400,40" }, signature: "home@1280x800" })]);
    // Same target again on the same layout: the verified box is reused, the model is not asked.
    const again = await run(rt, OPEN.slice(1));
    expect(truths(again)).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(vision.calls).toHaveLength(1);
    expect(screen.clicks).toHaveLength(2);
  });

  it("V3 an unsure, malformed or out-of-image answer is never clicked; the step ends honestly", async () => {
    const answers: unknown[] = [
      { found: true, box: videoBox(0), confidence: 0.3 },
      { found: true, box: videoBox(0) },
      { found: true, box: videoBox(0), confidence: Number.NaN },
      { found: true, box: { x: 1200, y: 700, w: 400, h: 400 }, confidence: 0.99 },
      { found: true, box: { x: "0", y: 100, w: 400, h: 40 }, confidence: 0.99 },
      { found: false, confidence: 0.9 },
      null,
    ];
    for (const answer of answers) {
      const { mem, flaky, screen } = broken();
      const rt = await start(new EscalatingEnvironment(flaky, { cache: new LocatorCache(), vision: new FakeVision(() => answer as never), screen }));
      const turns = await run(rt, OPEN);
      expect(turns[2].result?.truth).not.toBe("CONFIRMED");
      expect(screen.clicks).toEqual([]);
      expect(mem.page).toBe("home");
    }
  });

  it("V4 vision points at the wrong video: exactly one click, the read-back refuses, nothing cached", async () => {
    const { mem, flaky, screen } = broken();
    const cache = new LocatorCache();
    const rt = await start(new EscalatingEnvironment(flaky, { cache, vision: new FakeVision(() => ({ found: true, box: videoBox(1), confidence: 0.95 })), screen }));
    const turns = await run(rt, OPEN);
    expect(screen.clicks).toHaveLength(1);
    expect(mem.url).toBe("http://yt.test/watch?v=tatry");
    expect(turns[2].result?.truth).not.toBe("CONFIRMED");
    expect(cache.size).toBe(0);
  });

  it("V5 a focus is never turned into a pointer click", async () => {
    const { mem, flaky, screen } = broken("browser.focus");
    const vision = new FakeVision(() => ({ found: true, box: videoBox(0), confidence: 1 }));
    const rt = await start(new EscalatingEnvironment(flaky, { cache: new LocatorCache(), vision, screen }));
    const turns = await run(rt, GOLDEN_1_7.slice(0, 6));
    expect(turns[5].result?.truth).not.toBe("CONFIRMED");
    expect(screen.captures).toBe(0);
    expect(vision.calls).toEqual([]);
    expect(mem.highlight).toBeNull();
  });

  it("V6 a changed layout or a missing signature: no reuse, nothing cached; no vision configured stays not found", async () => {
    const { flaky, screen } = broken();
    const cache = new LocatorCache();
    const vision = new FakeVision(() => ({ found: true, box: videoBox(0), confidence: 0.9 }));
    const rt = await start(new EscalatingEnvironment(flaky, { cache, vision, screen }));
    await run(rt, OPEN);
    screen.signature = "home@800x600";
    expect(truths(await run(rt, OPEN.slice(1)))).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(vision.calls).toHaveLength(2);

    const b = broken();
    b.screen.signature = "";
    const cache2 = new LocatorCache();
    const rt2 = await start(new EscalatingEnvironment(b.flaky, { cache: cache2, vision, screen: b.screen }));
    expect(truths(await run(rt2, OPEN))).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED"]);
    expect(cache2.size).toBe(0);

    const c = broken();
    const env3 = new EscalatingEnvironment(c.flaky, { cache: new LocatorCache(), screen: c.screen });
    expect((await env3.capabilities()).find((x) => x.id === "vision")?.status).toBe("missing");
    const t3 = await run(await start(env3), OPEN);
    expect(t3[2].result?.truth).not.toBe("CONFIRMED");
    expect(c.screen.clicks).toEqual([]);
  });
});

describe("Skill Compiler", () => {
  it("S1 parses Polish commands after normalization", () => {
    const n = (s: string) => normalizeUtterance(s);
    expect(parseRememberSkill(n("Zapamiętaj to jako komentarz na mail."))).toBe("komentarz na mail");
    expect(parseRememberSkill(n("Jarvis, zapamiętaj te kroki jako pierwszy komentarz"))).toBe("pierwszy komentarz");
    expect(parseRememberSkill(n("zapamiętaj że jutro jest spotkanie"))).toBeNull();
    expect(parseRunSkill(n("Powtórz komentarz na mail."))).toBe("komentarz na mail");
    expect(parseRunSkill(n("uruchom umiejętność komentarz"))).toBe("komentarz");
  });

  it("S2 golden 1-7 remembered, replayed after a restart: every step verified again", async () => {
    const store = new MemoryStore();
    const first = new MemoryBrowser();
    const a = runtime(first, { skills: new SkillLibrary(store) });
    await a.rt.start();
    await run(a.rt, ["a jaka jutro pogoda?", ...GOLDEN_1_7]);
    const remember = a.rt.onText("Zapamiętaj to jako komentarz.");
    expect(remember.route).toBe("skill");
    expect(remember.say).toBe("Zapamiętałem: komentarz. 8 kroków.");
    expect((store.data as Skill[])[0].steps).toEqual(GOLDEN_1_7);

    // A new process: the library comes back from the store, the browser starts closed.
    const mem = new MemoryBrowser();
    const skills = new SkillLibrary(store);
    const b = runtime(mem, { skills });
    await b.rt.start();
    expect(b.rt.claims("Powtórz komentarz.", () => false)).toBe(true);
    expect(b.rt.claims("Powtórz coś innego.", () => false)).toBe(false);
    const replay = b.rt.onText("Powtórz komentarz.");
    await b.rt.idle();
    expect(replay.route).toBe("skill");
    expect(replay.say).toBe("Zrobione: komentarz. Każdy krok potwierdzony.");
    const steps = b.rt.turns.filter((t) => t.route === "action");
    expect(truths(steps)).toEqual(Array(8).fill("CONFIRMED"));
    expect(mem.clipboard).toBe("Łódź");
    expect(skills.list()[0]).toMatchObject({ runs: 1, lastOkAt: expect.any(Number) });
  });

  it("S3 a skill with a send stops at the consent question; nothing leaves before 'tak'", async () => {
    const store = new MemoryStore();
    const a = runtime(new MemoryBrowser(), { skills: new SkillLibrary(store), mail: new MockMail() });
    await a.rt.start();
    await run(a.rt, GOLDEN_1_7);
    a.rt.onText("Wyślij to mailem Marcinowi.");
    await waitFor(() => Object.keys(a.kernel.state.consents).length === 1);
    a.rt.onText("tak");
    await a.rt.idle();
    expect(a.rt.onText("zapamiętaj to jako komentarz na mail").say).toBe("Zapamiętałem: komentarz na mail. 9 kroków, wysyłkę zawsze potwierdzasz ty.");

    const mail = new MockMail();
    const b = runtime(new MemoryBrowser(), { skills: new SkillLibrary(store), mail });
    await b.rt.start();
    const replay = b.rt.onText("powtórz komentarz na mail");
    await waitFor(() => Object.keys(b.kernel.state.consents).length === 1);
    expect(mail.sent).toHaveLength(0);
    expect(b.said).toContain("Wysłać mail do Marcin Kubicki <marcin.kubicki@example.com> z treścią «Łódź»?");
    expect(replay.say).toBeUndefined();
    b.rt.onText("tak");
    await b.rt.idle();
    expect(mail.sent).toHaveLength(1);
    // The send speaks its own verified result; the skill never claims it.
    expect(replay.say).toBeUndefined();
    expect(b.rt.turns.find((t) => /^Wyślij/.test(t.text))?.say).toBe("Wysłane do Marcin. Jest w Wysłanych.");
    expect(Object.keys(b.kernel.state.consents)).toHaveLength(1);
  });

  it("S4 nothing unconfirmed is remembered; a step that cannot be replayed is refused", async () => {
    const skills = new SkillLibrary();
    const mem = new MemoryBrowser();
    const { rt } = runtime(mem, { skills });
    await rt.start();
    const turns = await run(rt, ["Znajdź komentarze."]); // no browser yet
    expect(turns[0].result?.truth).not.toBe("CONFIRMED");
    expect(rt.onText("zapamiętaj to jako nic").say).toBe("Nie mam potwierdzonych kroków do zapamiętania.");
    expect(skills.list()).toEqual([]);
    // Only the confirmed tail after the failure counts.
    await run(rt, GOLDEN_1_7.slice(0, 2));
    rt.onText("zapamiętaj to jako start");
    expect(skills.get("start")?.steps).toEqual(GOLDEN_1_7.slice(0, 2));
  });

  it("S5 a real failure invalidates the skill; a missing precondition or a stop does not", async () => {
    const store = new MemoryStore();
    const a = runtime(new MemoryBrowser(), { skills: new SkillLibrary(store) });
    await a.rt.start();
    await run(a.rt, GOLDEN_1_7);
    a.rt.onText("zapamiętaj to jako komentarz");

    // Precondition: no browser capability here. The skill survives.
    const noBrowser = new Flaky(new MemoryBrowser());
    noBrowser.caps = [];
    const skills1 = new SkillLibrary(store);
    const b = runtime(noBrowser, { skills: skills1 });
    await b.rt.start();
    const r1 = b.rt.onText("powtórz komentarz");
    await b.rt.idle();
    expect(r1.say).toBe("Nie mogę teraz dokończyć: komentarz.");
    expect(skills1.has("komentarz")).toBe(true);

    // Stop during the replay: dropped, not a failure.
    const slow = new MemoryBrowser({ delays: { "browser.findCollection": 150 } });
    const skills2 = new SkillLibrary(store);
    const c = runtime(slow, { skills: skills2 });
    await c.rt.start();
    const r2 = c.rt.onText("powtórz komentarz");
    await waitFor(() => slow.acts.some((x) => x.action.kind === "browser.findCollection"));
    c.rt.onText("stop");
    await c.rt.idle();
    expect(r2.say).toBeUndefined();
    expect(slow.acts.some((x) => x.action.kind === "text.select")).toBe(false);
    expect(skills2.has("komentarz")).toBe(true);

    // The page refuses the selection for real: the skill is switched off and no longer claimed.
    const broken = new Flaky(new MemoryBrowser());
    broken.failing.add("text.select");
    const skills3 = new SkillLibrary(store);
    const d = runtime(broken, { skills: skills3 });
    await d.rt.start();
    const r3 = d.rt.onText("powtórz komentarz");
    await d.rt.idle();
    expect(r3.say).toBe("Umiejętność komentarz tu już nie działa, więc ją wyłączyłem.");
    expect(skills3.has("komentarz")).toBe(false);
    expect(skills3.list()[0].invalidated?.reason).toMatch(/Zaznacz pierwsze cztery litery/);
    expect(d.rt.claims("powtórz komentarz", () => false)).toBe(false);
    expect(broken.mem.clipboard).toBe("");
  });

  it("S6 malformed stored skills are ignored; a second replay while one runs is refused", async () => {
    const store = new MemoryStore();
    store.data = [{ name: "x", steps: "rm -rf" }, null, { name: 3 }, { name: "ok", scope: "s", steps: ["Wejdź na YouTube."], external: false, compiledAt: 0, runs: 0 }];
    const skills = new SkillLibrary(store);
    expect(skills.list().map((s) => s.name)).toEqual(["ok"]);

    const mem = new MemoryBrowser({ delays: { "browser.launch": 60 } });
    const a = runtime(mem, { skills });
    await a.rt.start();
    await run(a.rt, ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube."]);
    a.rt.onText("zapamiętaj to jako start");
    const first = a.rt.onText("powtórz start");
    const second = a.rt.onText("powtórz start");
    expect(second.say).toBe("Już wykonuję umiejętność. Powiedz stop, jeśli mam przerwać.");
    await a.rt.idle();
    expect(first.say).toBe("Zrobione: start. Każdy krok potwierdzony.");
  });

  it("S7 remembering stops at a long pause (another errand) and at 12 steps", () => {
    let now = 0;
    const skills = new SkillLibrary(undefined, () => now);
    const t = (text: string, at: number): RuntimeTurn => ({ utteranceId: text, text, route: "action", at, result: { command: "scroll", truth: "CONFIRMED", say: "" } });
    const turns = [t("Wejdź na YouTube.", 0), t("Zjedź trochę niżej.", 20 * 60_000), t("Zjedź trochę niżej.", 20 * 60_000 + 5)];
    expect(skills.compile("a", turns, "env")).toMatchObject({ ok: true, skill: { steps: ["Zjedź trochę niżej.", "Zjedź trochę niżej."] } });
    const many = Array.from({ length: 20 }, (_, i) => t("Zjedź trochę niżej.", i));
    now = 5;
    const r = skills.compile("b", many, "env");
    expect(r.ok && r.skill.steps.length).toBe(12);
  });
});
