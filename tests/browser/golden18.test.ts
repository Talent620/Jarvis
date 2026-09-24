// Mission DoD scenario, steps 1-8, on a real Chromium with the YouTube fixture and a mock Gmail,
// through the same JarvisRuntime as production. Conversation is interleaved; consent is given
// exactly once at the send boundary; every action is confirmed by read-back.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime, type RuntimeTurn } from "../../src/lib/runtime/lanes/runtime";
import type { ConversationModel } from "../../src/lib/runtime/lanes/conversation";
import { ManagedBrowser } from "../../src/node/managedBrowser";
import { MockMail } from "../helpers/mockMail";
// @ts-expect-error plain ESM fixture without types
import { startYoutubeFixture } from "../fixtures/youtube/server.mjs";
import { findChromium } from "./chromium";

const model: ConversationModel = { reply: async (i) => (/pogod/i.test(i.utterance) ? "Jutro w Łodzi 18 stopni." : "Ładny, nocny spacer.") };

async function waitFor(cond: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function runGolden18(fixtureOptions: Record<string, unknown> = { rerenderMs: 2000 }) {
  const fixture = await startYoutubeFixture(fixtureOptions);
  const profile = mkdtempSync(join(tmpdir(), "jarvis-g18-"));
  const browser = new ManagedBrowser({ userDataDir: profile, executablePath: findChromium(), headless: true });
  const kernel = new Kernel();
  const mail = new MockMail();
  const said: string[] = [];
  const rt = new JarvisRuntime({
    kernel, env: browser, model, speaker: { say: (t) => { said.push(t); }, cancel: () => undefined },
    session: {
      youtubeUrl: `${fixture.url}/`, mail, mailOptions: { timeoutMs: 2000, recheckDelayMs: 50 },
      contacts: async () => [{ id: "m1", name: "Marcin Kubicki", emails: ["marcin.kubicki@example.com"], source: "fixture" }],
    },
  });
  try {
    await rt.start();
    const turns: RuntimeTurn[] = [];
    const say = (t: string) => { turns.push(rt.onText(t)); };
    say("Jarvis, uruchom przeglądarkę.");
    say("Wejdź na YouTube.");
    say("Otwórz pierwszy film.");
    say("a jaka jutro pogoda?");
    say("Zjedź trochę niżej.");
    say("Znajdź komentarze.");
    say("co teraz robisz?");
    say("Pierwszy komentarz.");
    say("co sądzisz o tym filmie?");
    say("Zaznacz pierwsze cztery litery.");
    say("Skopiuj.");
    say("Wyślij to mailem Marcinowi.");
    await waitFor(() => Object.keys(kernel.state.consents).length === 1);
    const consent = Object.values(kernel.state.consents)[0];
    say("tak");
    await rt.idle();
    return { turns, kernel, mail, said, consent };
  } finally {
    rt.stop();
    await browser.close();
    await fixture.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

function assertGolden18(r: Awaited<ReturnType<typeof runGolden18>>) {
  const actions = r.turns.filter((t) => t.route === "action" || t.route === "amend");
  const summary = actions.map((t) => `${t.result?.truth} ${t.text} -> ${t.say}`).join("\n");
  expect(actions.map((t) => t.result?.truth), summary).toEqual(Array(9).fill("CONFIRMED"));
  expect(r.turns.filter((t) => t.route === "side_chat").map((t) => t.say)).toEqual(["Jutro w Łodzi 18 stopni.", "Ładny, nocny spacer."]);
  expect(r.consent.summary).toBe("Wysłać mail do Marcin Kubicki <marcin.kubicki@example.com> z treścią «Łódź»?");
  expect(Object.keys(r.kernel.state.consents)).toHaveLength(1);
  expect(r.mail.sent).toEqual([expect.objectContaining({ to: "marcin.kubicki@example.com", body: "Łódź" })]);
  const mailAction = Object.values(r.kernel.state.actions).find((a) => a.kind === "mail.send")!;
  expect(mailAction).toMatchObject({ status: "CONFIRMED", external: true });
  expect(mailAction.evidence).toMatch(/^in Sent: msg-1 to marcin\.kubicki@example\.com/);
  expect(Object.values(r.kernel.state.actions).filter((a) => a.status !== "CONFIRMED")).toEqual([]);
}

describe("golden scenario 1-8 on the YouTube fixture (mission DoD)", () => {
  it("one run with chatter, one consent, mail confirmed from Sent", async () => {
    assertGolden18(await runGolden18());
  });

  it("comments without data-comment-id (like the real site), list re-rendered every 150 ms", async () => {
    assertGolden18(await runGolden18({ rerenderMs: 150, noCommentIds: true }));
  }, 60_000);

  it("10 consecutive green runs", async () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      assertGolden18(await runGolden18());
      times.push(Date.now() - t0);
    }
    console.log(`golden18 x10 ms: ${times.join(", ")}`);
  }, 600_000);
});
