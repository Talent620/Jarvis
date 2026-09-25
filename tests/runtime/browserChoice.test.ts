// B-035: "w mojej przeglądarce" drives the user's own browser (BrowserBridge), "w swojej
// przeglądarce" JARVIS's managed one. The switch is a verified step; without the extension it is
// refused honestly and the command runs nowhere.
import { describe, it, expect } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime, type Speaker } from "../../src/lib/runtime/lanes/runtime";
import { browserChoice, parseCommand } from "../../src/lib/runtime/commands";
import { SelectableBrowser } from "../../src/node/selectableBrowser";
import { MemoryBrowser } from "../helpers/memoryBrowser";

describe("browser choice in Polish", () => {
  it("parses the switch alone and inside a command", () => {
    expect(parseCommand("Użyj mojej przeglądarki.")).toEqual({ type: "browser.use", target: "user" });
    expect(parseCommand("Otwórz moją przeglądarkę")).toEqual({ type: "browser.launch" }); // after switching to it
    expect(parseCommand("Pracuj w swojej przeglądarce")).toEqual({ type: "browser.use", target: "managed" });
    expect(parseCommand("Wejdź na YouTube w mojej przeglądarce.")).toMatchObject({ type: "browser.gotoSite" });
    expect(browserChoice("Wejdź na YouTube w mojej przeglądarce.")).toBe("user");
    expect(browserChoice("w moim Chromie")).toBe("user");
    expect(browserChoice("Jarvis, uruchom przeglądarkę.")).toBeUndefined();
    expect(parseCommand("Jarvis, uruchom przeglądarkę.")).toEqual({ type: "browser.launch" });
  });

  it("remarks, questions and negations never switch browsers; a trailing 'Jarvis' is not a choice", () => {
    for (const t of ["moja przeglądarka jest wolna", "nie używaj mojej przeglądarki", "czy moja przeglądarka jest otwarta?", "Otwórz przeglądarkę, Jarvis"]) {
      expect(browserChoice(t), t).toBeUndefined();
      expect(parseCommand(t).type, t).not.toBe("browser.use");
    }
    expect(parseCommand("Otwórz przeglądarkę, Jarvis")).toEqual({ type: "browser.launch" });
    // "Otwórz swoją przeglądarkę" still opens a browser (JARVIS's, switched to first).
    expect(parseCommand("Otwórz swoją przeglądarkę")).toEqual({ type: "browser.launch" });
    expect(browserChoice("Otwórz swoją przeglądarkę")).toBe("managed");
    expect(browserChoice("Wejdź na YouTube w przeglądarce Jarvisa")).toBe("managed");
  });
});

function setup(connected: boolean) {
  const managed = new MemoryBrowser();
  const user = new MemoryBrowser({
    capabilities: [
      { id: "browser.managed.semantic", status: "available", checkedAt: 0, provider: "bridge" },
      { id: "browser.bridge", status: connected ? "available" : "missing", checkedAt: 0, provider: "browser-bridge" },
    ],
  });
  const env = new SelectableBrowser(managed, user);
  const kernel = new Kernel();
  const said: string[] = [];
  const speaker: Speaker = { say: (t) => { said.push(t); }, cancel: () => undefined };
  const rt = new JarvisRuntime({ kernel, env, speaker, session: { youtubeUrl: "http://yt.test/" } });
  return { managed, user, env, kernel, rt, said };
}

describe("switching browsers in the runtime", () => {
  it("'Wejdź na YouTube w mojej przeglądarce' switches (verified), then runs only in the user's browser", async () => {
    const { managed, user, env, kernel, rt, said } = setup(true);
    await rt.start();
    rt.onText("Jarvis, uruchom przeglądarkę.");
    await rt.idle();
    user.open = true; // the user's browser is running already
    const t = rt.onText("Wejdź na YouTube w mojej przeglądarce.");
    await rt.idle();
    expect(t.result?.truth).toBe("CONFIRMED");
    expect(env.selected).toBe("user");
    expect(user.acts.some((a) => a.action.kind === "browser.navigate")).toBe(true);
    expect(managed.acts.some((a) => a.action.kind === "browser.navigate")).toBe(false);
    expect(said.at(-1)).toMatch(/^Dobrze, pracuję w Twojej przeglądarce\. Jestem na YouTube/);
    const sw = Object.values(kernel.state.actions).find((a) => a.kind === "browser.use")!;
    expect(sw).toMatchObject({ status: "CONFIRMED" });
    expect(sw.evidence).toMatch(/user's own browser/);
    // Back to JARVIS's own browser.
    const back = rt.onText("Pracuj w swojej przeglądarce.");
    await rt.idle();
    expect(back.result?.truth).toBe("CONFIRMED");
    expect(env.selected).toBe("managed");
  });

  it("without the extension the switch is refused and the command runs nowhere", async () => {
    const { managed, user, env, rt, said } = setup(false);
    await rt.start();
    const t = rt.onText("Wejdź na YouTube w mojej przeglądarce.");
    await rt.idle();
    expect(t.result?.truth).toBe("NEEDS_CAPABILITY");
    expect(t.say).toBe("Nie widzę rozszerzenia JARVIS w Twojej przeglądarce. Zainstaluj je i sparuj kodem z ustawień.");
    expect(env.selected).toBe("managed");
    expect([...managed.acts, ...user.acts].some((a) => a.action.kind === "browser.navigate")).toBe(false);
    expect(said.at(-1)).toBe(t.say);
  });

  it("events of the browser that is not selected never reach the kernel", async () => {
    const { user, kernel, rt } = setup(true);
    await rt.start();
    rt.onText("Jarvis, uruchom przeglądarkę.");
    await rt.idle();
    const before = kernel.state.page?.url;
    user.emit({ type: "navigation", pageId: "tab-9-1", url: "https://bank.example/", title: "Bank" });
    expect(kernel.state.page?.url).toBe(before);
  });
});

describe("final review of the browser switch", () => {
  /** A user browser whose capability check is slow (to say "stop" meanwhile) or that goes silent. */
  function slowUser(user: MemoryBrowser, ms: number) {
    const caps = user.capabilities.bind(user);
    user.capabilities = async () => { await new Promise((r) => setTimeout(r, ms)); return caps(); };
  }

  it("'stop' while switching cancels the command too: nothing is opened, nothing is said", async () => {
    const { managed, user, kernel, rt, said } = setup(true);
    await rt.start();
    user.open = true;
    slowUser(user, 80);
    const t = rt.onText("Wejdź na YouTube w mojej przeglądarce.");
    await new Promise((r) => setTimeout(r, 20));
    const before = said.length;
    rt.onText("stop");
    await rt.idle();
    expect([...managed.acts, ...user.acts].some((a) => a.action.kind === "browser.navigate")).toBe(false);
    expect(kernel.state.tasks[t.result!.taskId!].status).toBe("cancelled");
    expect(said.slice(before)).toEqual([]);
  });

  it("a bridge that answers 'no tab' does not confirm the switch; the command runs nowhere", async () => {
    const { user, env, rt } = setup(true);
    await rt.start();
    user.open = false; // extension says connected, but no tab answers
    const t = rt.onText("Wejdź na YouTube w mojej przeglądarce.");
    await rt.idle();
    expect(t.result?.truth).not.toBe("CONFIRMED");
    expect(user.acts.some((a) => a.action.kind === "browser.navigate")).toBe(false);
    expect(env.selected).toBe("user"); // the variable moved, the read-back refused it
  });

  it("switching invalidates the other browser's page, and the clipboard is always the system one", async () => {
    const { managed, user, env, kernel, rt } = setup(true);
    await rt.start();
    rt.onText("Jarvis, uruchom przeglądarkę.");
    rt.onText("Wejdź na YouTube.");
    await rt.idle();
    expect(kernel.state.page?.url).toBe("http://yt.test/");
    rt.onText("Użyj mojej przeglądarki.");
    await rt.idle();
    expect(kernel.state.page?.id).toBe("closed"); // the user's browser has no tab open
    managed.clipboard = "Łódź";
    user.clipboard = "stale";
    expect(await env.read({ kind: "clipboard" })).toEqual({ ok: true, text: "Łódź" });
  });

  it("a skill recorded in the user's browser switches there first when replayed", async () => {
    const { SkillLibrary } = await import("../../src/lib/runtime/skills");
    const skills = new SkillLibrary();
    const managed = new MemoryBrowser();
    const user = new MemoryBrowser({ capabilities: [
      { id: "browser.managed.semantic", status: "available", checkedAt: 0 },
      { id: "browser.bridge", status: "available", checkedAt: 0 },
    ] });
    user.open = true;
    const env = new SelectableBrowser(managed, user);
    const rt = new JarvisRuntime({ kernel: new Kernel(), env, skills, session: { youtubeUrl: "http://yt.test/" } });
    await rt.start();
    rt.onText("Użyj mojej przeglądarki.");
    rt.onText("Wejdź na YouTube.");
    await rt.idle();
    rt.onText("zapamiętaj to jako jutub");
    expect(skills.get("jutub")?.browser).toBe("user");
    rt.onText("Pracuj w swojej przeglądarce.");
    await rt.idle();
    expect(env.selected).toBe("managed");
    const navBefore = user.acts.filter((a) => a.action.kind === "browser.navigate").length;
    const replay = rt.onText("powtórz jutub");
    await rt.idle();
    expect(replay.say).toBe("Zrobione: jutub. Każdy krok potwierdzony.");
    expect(env.selected).toBe("user");
    expect(user.acts.filter((a) => a.action.kind === "browser.navigate").length).toBe(navBefore + 1);
    expect(managed.acts.some((a) => a.action.kind === "browser.navigate")).toBe(false);
  });
});
