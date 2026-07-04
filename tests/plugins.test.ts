// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { loadPlugins, listPlugins, type JarvisPlugin } from "../src/plugins/PluginRegistry";
import pomodoroPlugin from "../src/plugins/examples/pomodoro.plugin";
import { toolDefs, runTool } from "../src/lib/tools";
import { grantOutboundScope } from "../src/lib/permissions";

describe("Plugin API", () => {
  it("rejestruje wtyczkę Pomodoro: narzędzia widoczne dla modelu (toolDefs)", () => {
    loadPlugins([pomodoroPlugin]);
    const names = toolDefs.map((d) => d.name);
    expect(names).toContain("pomodoro_start");
    expect(names).toContain("pomodoro_status");
    const entry = listPlugins().find((r) => r.plugin.id === "pomodoro")!;
    expect(entry.error).toBeUndefined();
    expect(entry.sections.length).toBe(1); // sekcja ustawień wtyczki
  });

  it("narzędzie wtyczki działa przez runTool (pełny cykl: start → status → koniec)", async () => {
    vi.useFakeTimers();
    loadPlugins([pomodoroPlugin]); // idempotentne — duplikat pominięty
    grantOutboundScope("*"); // narzędzie wtyczki = fail-safe outbound; test bada wykonanie
    expect(await runTool("pomodoro_start", { minutes: 1 })).toMatch(/1 minut/);
    expect(await runTool("pomodoro_status", {})).toMatch(/Zostało/);
    vi.advanceTimersByTime(61_000);
    expect(await runTool("pomodoro_status", {})).toMatch(/Żadna sesja/);
    vi.useRealTimers();
  });

  it("duplikat id wtyczki jest ignorowany (HMR/StrictMode-safe)", () => {
    const before = listPlugins().length;
    loadPlugins([pomodoroPlugin]);
    loadPlugins([pomodoroPlugin]);
    expect(listPlugins().length).toBe(before);
  });

  it("wadliwa wtyczka nie psuje aplikacji — błąd ląduje w jej wpisie", () => {
    const broken: JarvisPlugin = {
      id: "broken",
      name: "Zepsuta",
      version: "0.0.1",
      register() {
        throw new Error("celowa awaria");
      },
    };
    loadPlugins([broken]);
    const entry = listPlugins().find((r) => r.plugin.id === "broken")!;
    expect(entry.error).toMatch(/celowa awaria/);
    // pozostałe wtyczki nadal zarejestrowane
    expect(listPlugins().some((r) => r.plugin.id === "pomodoro")).toBe(true);
  });

  it("nieprawidłowa nazwa narzędzia wtyczki → czytelny błąd rejestracji", () => {
    const bad: JarvisPlugin = {
      id: "bad-tool",
      name: "Zła nazwa",
      version: "0.0.1",
      register(api) {
        api.registerTool("Złe Imię!", "opis testowy narzędzia", { type: "object", properties: {} }, () => "x");
      },
    };
    loadPlugins([bad]);
    expect(listPlugins().find((r) => r.plugin.id === "bad-tool")!.error).toMatch(/Nieprawidłowa nazwa/);
  });
});
