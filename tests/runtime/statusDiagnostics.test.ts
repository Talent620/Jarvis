// Mission M10: the "co robię" view, the panel with PAUZA / WZNÓW / STOP, and the redacted
// diagnostics export, on the same runtime as production with the in-memory YouTube.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime, type Speaker } from "../../src/lib/runtime/lanes/runtime";
import { exportDiagnostics, redact, statusView } from "../../src/lib/runtime/diagnostics";
import { SkillLibrary } from "../../src/lib/runtime/skills";
import { RuntimeStatusPanel, formatElapsed } from "../../src/components/RuntimeStatusPanel";
import type { Contact } from "../../src/lib/runtime/contacts";
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

function setup(delays: ConstructorParameters<typeof MemoryBrowser>[0] = {}) {
  const env = new MemoryBrowser(delays);
  const kernel = new Kernel();
  const said: string[] = [];
  const speaker: Speaker = { say: (t) => { said.push(t); }, cancel: () => undefined };
  const mail = new MockMail();
  const rt = new JarvisRuntime({
    kernel, env, speaker, skills: new SkillLibrary(),
    session: { youtubeUrl: "http://yt.test/", mail, mailOptions: { timeoutMs: 40, recheckDelayMs: 5 }, contacts: async () => BOOK, answerTimeoutMs: 3000 },
  });
  return { env, kernel, rt, said, mail };
}

describe("redaction", () => {
  it("masks mail addresses, phone numbers, keys, tokens and URL secrets, and clips", () => {
    const r = redact("Wyślij do marcin.kubicki@example.com, tel. +48 601 234 567, api_key=abc123 Bearer eyJhbGciOi.x.y https://x.test/cb?code=S3CR3T&state=1 sk-live1234567890");
    expect(r).not.toMatch(/marcin\.kubicki|example\.com|601 234 567|abc123|eyJhbGciOi|S3CR3T|sk-live/);
    expect(r).toContain("m***@***.com");
    expect(r).toContain("[telefon]");
    expect(r).toContain("code=[ukryte]");
    expect(redact("ab ".repeat(200), 50)).toHaveLength(50);
    expect(redact(undefined)).toBe("");
  });
});

describe("'co robię' view and panel", () => {
  it("idle, then running with goal, step, target, place and verification, then idle again", async () => {
    const { kernel, rt } = setup({ delays: { "browser.findCollection": 120 } });
    await rt.start();
    const idle = statusView(kernel.state, { now: Date.now(), environment: rt.environmentId });
    expect(idle).toMatchObject({ state: "idle", canStop: false, recent: [] });

    for (const t of GOLDEN_1_7.slice(0, 4)) rt.onText(t);
    await rt.idle();
    rt.onText("Znajdź komentarze.");
    await waitFor(() => statusView(kernel.state, { now: Date.now(), environment: "x" }).state === "running");
    const running = statusView(kernel.state, { now: Date.now(), environment: rt.environmentId, model: "bez modelu" });
    expect(running).toMatchObject({ state: "running", environment: "managed-browser", model: "bez modelu", canPause: true, canResume: false, canStop: true });
    expect(running.goal).toMatch(/Znajdź komentarze/);
    expect(running.place).toMatch(/yt\.test/);
    expect(running.elapsedMs).toBeGreaterThanOrEqual(0);
    await rt.idle();

    rt.onText("Pierwszy komentarz.");
    await rt.idle();
    const after = statusView(kernel.state, { now: Date.now(), environment: rt.environmentId });
    expect(after.state).toBe("idle");
    expect(after.recent[0]).toMatchObject({ kind: "browser.focus", truth: "CONFIRMED" });
    expect(after.recent.length).toBeLessThanOrEqual(5);
  });

  it("PAUZA / WZNÓW / STOP buttons take the same control path as the spoken words", async () => {
    const { env, kernel, rt, said } = setup({ delays: { "browser.findCollection": 150 } });
    await rt.start();
    for (const t of GOLDEN_1_7.slice(0, 4)) rt.onText(t);
    await rt.idle();
    rt.onText("Znajdź komentarze.");
    await waitFor(() => statusView(kernel.state, { now: Date.now(), environment: "x" }).state === "running");
    rt.press("pause");
    expect(statusView(kernel.state, { now: Date.now(), environment: "x" })).toMatchObject({ state: "paused", canPause: false, canResume: true });
    expect(said).toContain("Czekam.");
    rt.press("resume");
    expect(said).toContain("Wracam do pracy.");
    await rt.idle();
    expect(env.loaded).toBe(8);

    rt.onText("Znajdź więcej komentarzy.");
    await waitFor(() => statusView(kernel.state, { now: Date.now(), environment: "x" }).state === "running");
    rt.press("stop");
    await rt.idle();
    const task = Object.values(kernel.state.tasks).at(-1)!;
    expect(task.status).toBe("cancelled");
    expect(statusView(kernel.state, { now: Date.now(), environment: "x" }).state).toBe("idle");
  });

  it("renders the view with Polish labels, disabled buttons that do not apply, and no raw address", async () => {
    const { kernel, rt } = setup();
    await rt.start();
    for (const t of GOLDEN_1_7) rt.onText(t);
    await rt.idle();
    rt.onText("Wyślij to mailem Marcinowi.");
    await waitFor(() => Object.keys(kernel.state.consents).length === 1);
    const view = statusView(kernel.state, { now: Date.now(), environment: rt.environmentId, model: "bez modelu" });
    expect(view.state).toBe("waiting_consent");
    const html = renderToStaticMarkup(createElement(RuntimeStatusPanel, { view, onPause: () => {}, onResume: () => {}, onStop: () => {}, onExport: () => {} }));
    expect(html).toContain("Co robię: czeka na twoją zgodę");
    expect(html).toContain("Pytam o zgodę");
    expect(html).toContain("PAUZA");
    expect(html).toMatch(/<button type="button" disabled="" style="[^"]*">WZNÓW<\/button>/);
    expect(html).toContain("Eksport diagnostyki");
    expect(html).toContain("clipboard.copy: potwierdzone");
    expect(html).not.toContain("marcin.kubicki@example.com");
    rt.onText("nie");
    await rt.idle();
    expect(formatElapsed(65_000)).toBe("1 min 5 s");
  });
});

describe("diagnostics export", () => {
  it("is redacted, bounded and never contains clipboard or consent contents", async () => {
    const { kernel, rt, mail } = setup();
    await rt.start();
    for (const t of GOLDEN_1_7) rt.onText(t);
    await rt.idle();
    rt.onText("Wyślij to mailem Marcinowi.");
    await waitFor(() => Object.keys(kernel.state.consents).length === 1);
    rt.onText("tak");
    await rt.idle();
    expect(mail.sent).toHaveLength(1);
    rt.onText("zapamiętaj to jako komentarz na mail");
    const d = exportDiagnostics({ state: kernel.state, turns: rt.turns, skills: rt.listSkills(), environment: rt.environmentId, now: Date.now(), latency: { final_to_verified: { count: 9, p50: 70, p95: 400 } } });
    const json = JSON.stringify(d);
    expect(d.format).toBe("jarvis-diagnostics/1");
    expect(json).not.toContain("marcin.kubicki@example.com");
    expect(json).not.toContain("Łódź"); // clipboard text and the mail body stay out
    expect(d.clipboard).toMatchObject({ byJarvis: true });
    expect(d.consents).toEqual([expect.objectContaining({ status: "granted", summaryChars: expect.any(Number) })]);
    expect(d.actions.map((a) => a.status).every((s) => s === "CONFIRMED")).toBe(true);
    expect(d.actions.some((a) => a.external)).toBe(true);
    expect(d.skills).toEqual([{ name: "komentarz na mail", steps: 9, external: true, runs: 0, invalidated: undefined }]);
    expect(d.page?.host).toBe("yt.test");
    expect(d.turns.length).toBeLessThanOrEqual(40);
    expect(d.latency?.final_to_verified.p95).toBe(400);
    expect(d.actions.find((a) => a.kind === "clipboard.copy")?.evidence).toBe("clipboard [4 zn.]");
    expect(json).not.toContain("Piotrkowskiej"); // video title from what JARVIS said
  });
});

describe("skills in the panel (B-039)", () => {
  it("lists remembered skills with their state and removes one for good", async () => {
    const { kernel, rt } = setup();
    await rt.start();
    for (const t of GOLDEN_1_7) rt.onText(t);
    await rt.idle();
    rt.onText("zapamiętaj to jako komentarz");
    const view = statusView(kernel.state, { now: Date.now(), environment: rt.environmentId });
    const html = renderToStaticMarkup(createElement(RuntimeStatusPanel, { view, skills: rt.listSkills(), onForgetSkill: () => {} }));
    expect(html).toContain("Umiejętności (1)");
    expect(html).toContain("komentarz: 8 kroków");
    expect(html).toContain('aria-label="Usuń umiejętność komentarz"');
    expect(rt.forgetSkill("komentarz")).toBe(true);
    expect(rt.listSkills()).toEqual([]);
    expect(rt.claims("powtórz komentarz", () => false)).toBe(false);
    const empty = renderToStaticMarkup(createElement(RuntimeStatusPanel, { view, skills: rt.listSkills() }));
    expect(empty).not.toContain("Umiejętności");
  });
});
