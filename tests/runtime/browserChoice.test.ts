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
    expect(parseCommand("Otwórz moją przeglądarkę")).toEqual({ type: "browser.use", target: "user" });
    expect(parseCommand("Pracuj w swojej przeglądarce")).toEqual({ type: "browser.use", target: "managed" });
    expect(parseCommand("Wejdź na YouTube w mojej przeglądarce.")).toMatchObject({ type: "browser.gotoSite" });
    expect(browserChoice("Wejdź na YouTube w mojej przeglądarce.")).toBe("user");
    expect(browserChoice("w moim Chromie")).toBe("user");
    expect(browserChoice("Jarvis, uruchom przeglądarkę.")).toBeUndefined();
    expect(parseCommand("Jarvis, uruchom przeglądarkę.")).toEqual({ type: "browser.launch" });
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
