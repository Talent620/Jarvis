// Regression tests for the final adversarial review (M7-M10). Each case is a failure scenario
// the reviewer found; the numbers follow the review.
import { describe, it, expect } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { performAction } from "../../src/lib/runtime/actions";
import type { ActResult, ComputerEnvironment, EnvAction, FocusedRead, ReadQuery, ReadResult } from "../../src/lib/runtime/env/types";
import type { CapabilityState } from "../../src/lib/runtime/types";

/** A desktop whose focused field and clipboard are plain variables; input can "go elsewhere". */
class FakeDesktop implements ComputerEnvironment {
  readonly id = "fake-desktop";
  field = { role: "entry", name: "Odpowiedź", text: "" };
  clipboard = "";
  /** Keystrokes land in another window: the focused field does not change. */
  elsewhere = false;
  async capabilities(): Promise<CapabilityState[]> {
    return ["desktop.clipboard", "linux.input.xdotool", "linux.atspi", "desktop.active_window"].map((id) => ({ id, status: "available" as const, checkedAt: 0 }));
  }
  async act(a: EnvAction): Promise<ActResult> {
    if (a.kind === "desktop.type") { if (!this.elsewhere) this.field.text += a.text; return { status: "done" }; }
    if (a.kind === "desktop.keys") { if (!this.elsewhere && a.keys === "ctrl+c") this.clipboard = this.field.text; return { status: "done" }; }
    return { status: "needs_capability" };
  }
  async read(q: ReadQuery): Promise<ReadResult> {
    if (q.kind === "focused") return { found: true, ...this.field } satisfies FocusedRead;
    if (q.kind === "clipboard") return { ok: true, text: this.clipboard };
    if (q.kind === "window") return { found: true, window: { id: "0x1", title: "Okno" } };
    return { open: false };
  }
  onEvent() { return () => undefined; }
  async close() { /* nothing */ }
}

async function perform(env: ComputerEnvironment, action: EnvAction) {
  const kernel = new Kernel();
  kernel.dispatch({ type: "CapabilitiesUpdated", capabilities: await env.capabilities() });
  kernel.dispatch({ type: "TaskCreated", taskId: "T", goal: "test", kind: "test" });
  return performAction({ kernel, env }, { taskId: "T", action });
}

describe("final review #3: desktop input needs evidence of a change", () => {
  it("typing is CONFIRMED only when the field gained the text", async () => {
    const env = new FakeDesktop();
    env.field.text = "tak";
    expect((await perform(env, { kind: "desktop.type", text: " tak" })).truth).toBe("CONFIRMED");
    expect(env.field.text).toBe("tak tak");
  });

  it("the field already contained the text and the keys went elsewhere: not CONFIRMED", async () => {
    const env = new FakeDesktop();
    env.field.text = "tak";
    env.elsewhere = true;
    const r = await perform(env, { kind: "desktop.type", text: "tak" });
    expect(r.truth).toBe("FAILED");
  });

  it("ctrl+c while the clipboard already held the text proves nothing: ATTEMPTED", async () => {
    const env = new FakeDesktop();
    env.field.text = "Łódź";
    env.clipboard = "Łódź";
    env.elsewhere = true;
    const r = await perform(env, { kind: "desktop.keys", keys: "ctrl+c", expectClipboard: "Łódź" });
    expect(r.truth).toBe("ATTEMPTED");
    env.clipboard = "";
    env.elsewhere = false;
    expect((await perform(env, { kind: "desktop.keys", keys: "ctrl+c", expectClipboard: "Łódź" })).truth).toBe("CONFIRMED");
  });
});

describe("final review #4: desktop selection is read back from the desktop", () => {
  class Side implements ComputerEnvironment {
    acts: EnvAction[] = [];
    selection: { text: string; ref?: string } = { text: "" };
    constructor(readonly id: string, private readonly caps: string[], private readonly selects: boolean) {}
    async capabilities(): Promise<CapabilityState[]> { return this.caps.map((id) => ({ id, status: "available" as const, checkedAt: 0 })); }
    async act(a: EnvAction): Promise<ActResult> {
      this.acts.push(a);
      if (a.kind === "text.select" && this.selects) this.selection = { text: a.expected, ref: a.target.ref };
      return { status: "done" };
    }
    async read(q: ReadQuery): Promise<ReadResult> {
      if (q.kind === "selection") return { ...this.selection, visible: !!this.selection.text };
      return { open: false };
    }
    onEvent() { return () => undefined; }
    async close() { /* nothing */ }
  }

  it("the browser holding the same text does not confirm an AT-SPI selection that did nothing", async () => {
    const { CompositeEnvironment } = await import("../../src/node/compositeEnvironment");
    const browser = new Side("managed-browser", ["browser.managed.semantic"], false);
    browser.selection = { text: "Łódź" }; // selected on some page, no ref
    const desktop = new Side("linux-desktop", ["linux.atspi"], false);
    const env = new CompositeEnvironment(browser, desktop);
    const r = await perform(env, { kind: "text.select", target: { ref: "atspi:focused" }, start: 0, end: 4, expected: "Łódź" });
    expect(r.truth).not.toBe("CONFIRMED");
    expect(desktop.acts).toHaveLength(2); // routed to the desktop (two attempts), never to the browser
    expect(browser.acts).toHaveLength(0);
  });

  it("a real desktop selection (AT-SPI or UIA) is CONFIRMED from the desktop", async () => {
    const { CompositeEnvironment } = await import("../../src/node/compositeEnvironment");
    for (const ref of ["atspi:focused", "uia:focused"]) {
      const browser = new Side("managed-browser", ["browser.managed.semantic"], false);
      const desktop = new Side("desktop", ["linux.atspi", "windows.uia"], true);
      const r = await perform(new CompositeEnvironment(browser, desktop), { kind: "text.select", target: { ref }, start: 0, end: 4, expected: "Łódź" });
      expect(r.truth).toBe("CONFIRMED");
      expect(browser.acts).toHaveLength(0);
    }
  });
});

describe("final review #5: the Linux window poller never stacks and never throws", () => {
  it("a hung X call holds one poll, not one per tick; invalid tool JSON is an error value", async () => {
    const { LinuxDesktopEnvironment } = await import("../../src/node/linux/environment");
    const { LinuxWindows } = await import("../../src/node/linux/desktop");
    let active = 0;
    const run = async (cmd: string, args: string[]) => {
      if (cmd === "sh") return { code: 0, stdout: "xdotool\nwmctrl\n", stderr: "" };
      if (cmd === "xdotool" && args[0] === "getactivewindow") { active++; return new Promise<never>(() => undefined); }
      return { code: 1, stdout: "", stderr: "no" };
    };
    const env = new LinuxDesktopEnvironment({ run, env: { DISPLAY: ":0" }, pollMs: 10 });
    const off = env.onEvent(() => undefined);
    await new Promise((r) => setTimeout(r, 150));
    off();
    await env.close();
    expect(active).toBe(1);

    const bad = async () => ({ code: 0, stdout: "{not json", stderr: "" });
    const hypr = new LinuxWindows(bad, { display: "wayland", desktop: "", tools: new Set(["hyprctl"]), atspiPython: null, portal: false });
    await expect(hypr.active()).resolves.toMatchObject({ found: false });
    await expect(hypr.list()).resolves.toMatchObject({ windows: [] });
  });
});

describe("final review #8: diagnostics never let quoted screen text through", () => {
  it("quotes inside quotes are masked as a whole", async () => {
    const { maskQuoted } = await import("../../src/lib/runtime/diagnostics");
    expect(maskQuoted('clipboard "a "b" c"')).toBe("clipboard [7 zn.]");
    expect(maskQuoted("selection „Łódź” visible=true")).toBe("selection [4 zn.] visible=true");
    expect(maskQuoted('open "x')).toBe("open [1 zn.]");
    expect(maskQuoted("no quotes here")).toBe("no quotes here");
  });
});

describe("final review #9: a crash inside a step is an audible FAILED, and a skill replay stops on it", () => {
  it("the user hears the failure; the skill is switched off, not left as a silent stop", async () => {
    const { JarvisRuntime } = await import("../../src/lib/runtime/lanes/runtime");
    const { SkillLibrary } = await import("../../src/lib/runtime/skills");
    const { MemoryBrowser } = await import("../helpers/memoryBrowser");
    const skills = new SkillLibrary();
    const said: string[] = [];
    const rt = new JarvisRuntime({ kernel: new Kernel(), env: new MemoryBrowser(), skills, speaker: { say: (t) => { said.push(t); }, cancel: () => undefined }, session: { youtubeUrl: "http://yt.test/" } });
    await rt.start();
    for (const t of ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube."]) rt.onText(t);
    await rt.idle();
    rt.onText("zapamiętaj to jako start");
    const handle = rt.session.handle.bind(rt.session);
    rt.session.handle = async (text, o) => { if (/YouTube/.test(text)) throw new Error("boom"); return handle(text, o); };
    const replay = rt.onText("powtórz start");
    await rt.idle();
    expect(said).toContain("Coś poszło nie tak, tego nie zrobiłem.");
    expect(replay.say).toBe("Umiejętność start tu już nie działa, więc ją wyłączyłem.");
    expect(skills.has("start")).toBe(false);
  });
});

describe("review of the voice switch and browser choice", () => {
  it("#5 the Deepgram key is a secret at rest like the other keys", async () => {
    const { blankSensitive } = await import("../../src/lib/secretsVault");
    const { store } = await import("../../src/lib/store");
    const out = blankSensitive({ ...store.settings, deepgramApiKey: "dg-secret-123" });
    expect(out.deepgramApiKey).toBe("");
  });

  it("#8 the bridge server can be started again after a failed start and on the same object", async () => {
    const { BridgeServer } = await import("../../src/node/bridge/server");
    const { Pairing, TokenStore } = await import("../../src/node/bridge/protocol");
    const a = new BridgeServer({ tokens: new TokenStore(), pairing: new Pairing() });
    const port = await a.start();
    expect(await a.start()).toBe(port); // idempotent while listening
    const b = new BridgeServer({ tokens: new TokenStore(), pairing: new Pairing(), port });
    const env = b.env;
    await expect(b.start()).rejects.toThrow();
    await a.close();
    expect(await b.start()).toBe(port);
    expect(b.env).toBe(env); // the runtime's reference stays valid
    await b.close();
  });
});
