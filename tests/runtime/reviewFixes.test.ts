// Regression tests for the adversarial review of M1-M3 (findings H1-H4, M1-M10).
import { describe, it, expect } from "vitest";
import { verify } from "../../src/lib/runtime/postconditions";
import { IpcEnvironment } from "../../src/lib/runtime/env/ipc";
import { Kernel } from "../../src/lib/runtime/kernel";
import { MemoryJournal } from "../../src/lib/runtime/journal";
import { performAction } from "../../src/lib/runtime/actions";
import { sendExactlyOnce } from "../../src/lib/runtime/mail";
import type { ActResult, ComputerEnvironment, EnvAction } from "../../src/lib/runtime/env/types";
import { MockMail } from "../helpers/mockMail";
import { parseCommand } from "../../src/lib/runtime/commands";
import { MemoryBrowser } from "../helpers/memoryBrowser";
import { JarvisRuntime } from "../../src/lib/runtime/lanes/runtime";
import type { Contact } from "../../src/lib/runtime/contacts";

const done: ActResult = { status: "done" };

describe("H1: a failed read is never a confirmed postcondition", () => {
  it("IPC failed envelopes are thrown by read/capabilities/snapshot", async () => {
    const env = new IpcEnvironment("x", { call: async () => ({ status: "failed", error: "Target closed" }), onEvent: () => () => {} });
    await expect(env.read({ kind: "page" })).rejects.toThrow("Target closed");
    await expect(env.capabilities()).rejects.toThrow("Target closed");
    await expect(env.snapshot()).rejects.toThrow("Target closed");
  });

  it("scroll up/start with an unreadable or closed page is not CONFIRMED", () => {
    const up: EnvAction = { kind: "browser.scroll", direction: "up", amount: "page" };
    const start: EnvAction = { kind: "browser.scroll", direction: "up", amount: "start" };
    const before = { open: true, scrollY: 1200, viewportHeight: 800, documentHeight: 4000 };
    for (const after of [{ open: false }, { open: true }, { status: "failed", error: "x" } as never]) {
      expect(verify(up, before, after, done, 0).truth).not.toBe("CONFIRMED");
      expect(verify(start, before, after, done, 0).truth).not.toBe("CONFIRMED");
    }
    expect(verify(up, before, { ...before, scrollY: 400 }, done, 0).truth).toBe("CONFIRMED");
  });

  it("consent is gone only on an open page off the consent host", () => {
    const a: EnvAction = { kind: "browser.consent", choice: "reject" };
    expect(verify(a, undefined, { open: false }, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, undefined, { status: "failed", error: "x" } as never, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, undefined, { open: true, url: "https://consent.youtube.com/m", consentWall: false }, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, undefined, { open: true, url: "https://www.youtube.com/", consentWall: false }, done, 0).truth).toBe("CONFIRMED");
  });

  it("open needs a known before URL and must land on the target's own link (H2)", () => {
    const a: EnvAction = { kind: "browser.open", target: { ref: "yt-video:/watch?v=lodz", semanticKey: "video:/watch?v=lodz" } };
    expect(verify(a, undefined, { open: true, url: "https://yt/watch?v=lodz" }, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, { open: true, url: "https://yt/" }, { open: true, url: "https://yt/watch?v=other" }, done, 0).truth).not.toBe("CONFIRMED");
    expect(verify(a, { open: true, url: "https://yt/" }, { open: true, url: "https://yt/watch?v=lodz" }, done, 0).truth).toBe("CONFIRMED");
  });

  it("a malformed capabilities event is ignored instead of throwing in dispatch", () => {
    const k = new Kernel();
    expect(() => k.dispatch({ type: "CapabilitiesUpdated", capabilities: { status: "failed" } as never })).not.toThrow();
    expect(k.state.capabilities).toEqual({});
  });
});

describe("H3: an external effect that may have happened is never a clean failure", () => {
  const mailArgs = { to: "marcin.kubicki@example.com", subject: "Łódź", body: "Łódź" };
  const fast = { timeoutMs: 40, recheckDelayMs: 5 };
  const kernelWithTask = (journal?: MemoryJournal) => {
    const k = new Kernel({ journal });
    k.dispatch({ type: "CapabilitiesUpdated", capabilities: [{ id: "browser.managed.semantic", status: "available", checkedAt: 0 }] });
    k.dispatch({ type: "TaskCreated", taskId: "T", goal: "g", kind: "k" });
    return k;
  };

  it("a throwing act() on an external action is UNKNOWN_AFTER_ATTEMPT and keeps the idempotency key", async () => {
    const k = kernelWithTask();
    let calls = 0;
    const env = {
      id: "throwing", capabilities: async () => [], onEvent: () => () => {}, close: async () => {}, snapshot: async () => "",
      act: async () => { calls++; throw new Error("socket hang up"); },
      read: async () => ({ ok: true, text: "Łódź" }),
    } as unknown as ComputerEnvironment;
    const r = await performAction({ kernel: k, env }, { taskId: "T", external: true, idempotencyKey: "ext-1", action: { kind: "clipboard.copy", expected: "Łódź" } });
    expect(r.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(calls).toBe(1);
    expect(k.state.idempotency["ext-1"]).toBe(r.actionId);
    const again = await performAction({ kernel: k, env }, { taskId: "T", external: true, idempotencyKey: "ext-1", action: { kind: "clipboard.copy", expected: "Łódź" } });
    expect(again.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(calls).toBe(1);
  });

  it("an external action is journalled as attempted before act() runs (crash mid-effect restores UNKNOWN)", async () => {
    const j = new MemoryJournal();
    const k = kernelWithTask(j);
    let release!: () => void;
    const env = {
      id: "hanging", capabilities: async () => [], onEvent: () => () => {}, close: async () => {}, snapshot: async () => "",
      act: () => new Promise<ActResult>((res) => { release = () => res({ status: "done" }); }),
      read: async () => ({ ok: true, text: "Łódź" }),
    } as unknown as ComputerEnvironment;
    const p = performAction({ kernel: k, env }, { taskId: "T", external: true, action: { kind: "clipboard.copy", expected: "Łódź" } });
    await new Promise((r) => setTimeout(r, 5));
    const id = Object.keys(k.state.actions)[0];
    expect(k.state.actions[id].status).toBe("ATTEMPTED");
    await k.flush();
    const k2 = await Kernel.restore(j);
    expect(k2.state.actions[id].status).toBe("UNKNOWN_AFTER_ATTEMPT");
    release();
    await p;
  });

  it("mail: a client that throws after delivering is resolved from Sent, one message", async () => {
    const k = kernelWithTask();
    const m = new MockMail();
    m.failures = ["throw-after-send"];
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r).toMatchObject({ truth: "CONFIRMED", sends: 1 });
    expect(m.sent).toHaveLength(1);
  });

  it("mail: a rejection on the retry does not erase the unknown first attempt", async () => {
    const k = kernelWithTask();
    const m = new MockMail();
    m.failures = ["timeout-before-send", "error-before-send"];
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(k.state.actions[r.actionId!].status).toBe("UNKNOWN_AFTER_ATTEMPT");
    // The key is kept: a new "wyślij" checks Sent instead of sending blind.
    const again = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(again).toMatchObject({ duplicate: true, sends: 0 });
  });

  it("mail: the provider id reaches the evidence after the pre-send record", async () => {
    const k = kernelWithTask();
    const m = new MockMail();
    m.failures = ["sent-not-visible"];
    const r = await sendExactlyOnce(k, m, { taskId: "T", mail: mailArgs }, fast);
    expect(r.truth).toBe("UNKNOWN_AFTER_ATTEMPT");
    expect(k.state.actions[r.actionId!].evidence).toBe("provider id msg-1");
  });
});

describe("M1: task states around consent are honest", () => {
  const C = (id: string, name: string, email: string): Contact => ({ id, name, emails: [email], source: "fixture" });
  async function mailRuntime(book: Contact[] = [C("m1", "Marcin Kubicki", "marcin.kubicki@example.com")]) {
    const env = new MemoryBrowser();
    const kernel = new Kernel();
    const mail = new MockMail();
    const said: string[] = [];
    const rt = new JarvisRuntime({
      kernel, env, speaker: { say: (t) => { said.push(t); }, cancel: () => undefined },
      session: { youtubeUrl: "http://yt.test/", mail, mailOptions: { timeoutMs: 40, recheckDelayMs: 5 }, contacts: async () => book, answerTimeoutMs: 2000 },
    });
    await rt.start();
    for (const t of ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Zjedź trochę niżej.", "Znajdź komentarze.", "Pierwszy komentarz.", "Zaznacz pierwsze cztery litery.", "Skopiuj."]) rt.onText(t);
    await rt.idle();
    return { rt, kernel, mail, said };
  }
  const until = async (cond: () => boolean, ms = 1500) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const tick = () => new Promise((r) => setTimeout(r, 30));

  it("pause while waiting for consent, resume: waits for consent again, nothing sent without 'tak'", async () => {
    const { rt, kernel, mail } = await mailRuntime();
    const send = rt.onText("Wyślij to mailem Marcinowi.");
    await until(() => Object.keys(kernel.state.consents).length === 1);
    const taskId = Object.values(kernel.state.consents)[0].taskId;
    rt.onText("poczekaj");
    expect(kernel.state.tasks[taskId].status).toBe("paused");
    rt.onText("wznów");
    expect(kernel.state.tasks[taskId].status).toBe("waiting_consent");
    await tick();
    expect(mail.calls.filter((c) => c === "send")).toHaveLength(0);
    rt.onText("tak");
    await rt.idle();
    expect(send.result?.truth).toBe("CONFIRMED");
    expect(mail.sent).toHaveLength(1);
  });

  it("'tak' while paused grants the consent but the mail leaves only after 'wznów'", async () => {
    const { rt, kernel, mail } = await mailRuntime();
    const send = rt.onText("Wyślij to mailem Marcinowi.");
    await until(() => Object.keys(kernel.state.consents).length === 1);
    rt.onText("poczekaj");
    rt.onText("tak");
    await tick();
    expect(Object.values(kernel.state.consents)[0].status).toBe("granted");
    expect(mail.calls.filter((c) => c === "send")).toHaveLength(0);
    rt.onText("wznów");
    await rt.idle();
    expect(send.result?.truth).toBe("CONFIRMED");
    expect(mail.sent).toHaveLength(1);
  });

  it("'ok' or 'dobra' is not consent for an external effect", async () => {
    const { rt, kernel, mail, said } = await mailRuntime();
    rt.onText("Wyślij to mailem Marcinowi.");
    await until(() => Object.keys(kernel.state.consents).length === 1);
    for (const casual of ["ok", "dobra", "jasne"]) {
      const t = rt.onText(casual);
      expect(t.route).toBe("ignored");
    }
    await tick();
    expect(Object.values(kernel.state.consents)[0].status).toBe("pending");
    expect(mail.calls.filter((c) => c === "send")).toHaveLength(0);
    expect(said).toContain("Powiedz wyraźnie: tak, wyślij. Albo: nie.");
    rt.onText("tak, wyślij");
    await rt.idle();
    expect(mail.sent).toHaveLength(1);
  });

  it("the recipient question waits (not blocked), and blocked is final for waiters", async () => {
    const { rt, kernel } = await mailRuntime([C("m1", "Marcin Kubicki", "a@example.com"), C("m2", "Marcin Nowicki", "b@example.com")]);
    rt.onText("Wyślij to mailem Marcinowi.");
    await until(() => Object.values(kernel.state.tasks).some((t) => t.statusReason === "waiting for the recipient"));
    const t = Object.values(kernel.state.tasks).find((x) => x.statusReason === "waiting for the recipient")!;
    expect(t.status).toBe("waiting_consent");
    rt.onText("nie");
    await rt.idle();
    expect(kernel.state.tasks[t.id].status).toBe("blocked");
    await expect(kernel.waitRunnable(t.id)).rejects.toThrow();
  });

  it("a consent for an ended task is born denied; ending a task denies its pending consent", () => {
    const k = new Kernel();
    k.dispatch({ type: "TaskCreated", taskId: "A", goal: "g", kind: "k" });
    k.dispatch({ type: "ConsentRequested", consentId: "c1", taskId: "A", summary: "s", args: {} });
    k.dispatch({ type: "TaskCancelled", taskId: "A", reason: "stop" });
    expect(k.state.consents.c1.status).toBe("denied");
    k.dispatch({ type: "ConsentRequested", consentId: "c2", taskId: "A", summary: "s", args: {} });
    expect(k.state.consents.c2.status).toBe("denied");
    k.dispatch({ type: "ConsentGranted", consentId: "c2" });
    expect(k.state.consents.c2.status).toBe("denied");
  });

  it("a stale 'tak' does not grant a consent the user never heard", () => {
    const k = new Kernel();
    const rt = new JarvisRuntime({ kernel: k, env: new MemoryBrowser() });
    k.dispatch({ type: "TaskCreated", taskId: "A", goal: "g", kind: "k" });
    // Requested without being announced through the runtime (e.g. from another component).
    k.dispatch({ type: "ConsentRequested", consentId: "c1", taskId: "A", summary: "s", args: {} });
    rt.onText("tak");
    expect(k.state.consents.c1.status).toBe("pending");
  });
});

describe("M2: mentioning YouTube or the browser is not a command", () => {
  it.each([
    ["Wejdź na YouTube.", "browser.gotoSite"],
    ["YouTube", "browser.gotoSite"],
    ["Możesz wejść na YouTube?", "browser.gotoSite"],
    ["czy możesz otworzyć jutuba", "browser.gotoSite"],
    ["Jarvis, uruchom przeglądarkę.", "browser.launch"],
    ["odpal chrome", "browser.launch"],
    ["co sądzisz o YouTube?", "unknown"],
    ["czy lubisz YouTube?", "unknown"],
    ["jak działa YouTube", "unknown"],
    ["wczoraj oglądałem na YouTube fajny film o kotach", "unknown"],
    ["czy uruchomiłeś przeglądarkę?", "unknown"],
    ["przeglądarka jest dziś strasznie wolna", "unknown"],
  ])("%s -> %s", (text, type) => {
    expect(parseCommand(text).type).toBe(type);
  });
});
