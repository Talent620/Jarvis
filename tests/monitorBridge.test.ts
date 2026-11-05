// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { monitorCommand, listWindowsOnPc, focusWindowOnPc } from "../src/lib/desktop";
import { runTool, toolDefs } from "../src/lib/tools";
import { resetConsents, setAutoConsent, clearOutboundScope } from "../src/lib/permissions";

afterEach(() => {
  delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop;
  resetConsents(); setAutoConsent(false); clearOutboundScope();
});

describe("trwałe monitory przez normalną bramkę narzędzi", () => {
  it("nie udaje monitorowania w przeglądarce bez wykonawcy", async () => {
    const result = await monitorCommand({ action: "list" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("desktopowej");
  });

  it("model nie ma narzędzia do nadania zgody i nie omija komendy create polem action", async () => {
    const command = vi.fn(async (request) => request.action === "create"
      ? { ok: false, error: "WAITING_APPROVAL: source grant required" }
      : { ok: true });
    Object.assign(window, { jarvisDesktop: { monitorCommand: command } });
    expect(toolDefs.some((tool) => /monitor.*grant/.test(tool.name))).toBe(false);
    const denied = await monitorCommand({ action: "grant", trustedUserAction: true });
    expect(denied.ok).toBe(false);
    expect(command).not.toHaveBeenCalled();
    const result = await runTool("monitor_create", {
      action: "grant", title: "obserwuj", source: { kind: "json", url: "https://example.org/feed.json" },
      criteria: { contains: "Produkt" }, intervalMs: 60000,
    });
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ action: "create", timezone: "Europe/Warsaw" }));
    expect(JSON.parse(result)).toEqual({ ok: false, error: "WAITING_APPROVAL: source grant required" });
  });

  it("sterowanie nie rozszerza uprawnień, a STOP odcina zaległe utworzenie", async () => {
    const command = vi.fn(async () => ({ ok: true }));
    Object.assign(window, { jarvisDesktop: { monitorCommand: command } });
    expect(await runTool("monitor_control", { action: "grant" })).toContain("Niedozwolone");
    expect(command).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(runTool("monitor_create", { title: "stare zadanie" }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(command).not.toHaveBeenCalled();
    await runTool("monitor_control", { action: "stop_all" });
    expect(command).toHaveBeenCalledWith({ action: "stop_all" });
  });

  it("odczytuje zapisany status i błędy źródła bez ogłaszania sukcesu", async () => {
    const snapshot = { ok: true, goals: [{ id: "g1", state: "BLOCKED", lastResult: "SOURCE_ERROR" }], events: [] };
    Object.assign(window, { jarvisDesktop: { monitorCommand: vi.fn(async () => snapshot) } });
    expect(JSON.parse(await runTool("monitor_status", {}))).toEqual(snapshot);
  });

  it("przekazuje identyfikator i tytuł okna do adaptera i zachowuje odmowę fokusu", async () => {
    const focusWindow = vi.fn(async () => ({ ok: false, error: "err:linux-window-mismatch" }));
    Object.assign(window, { jarvisDesktop: { listWindows: vi.fn(async () => ({ ok: true, windows: [{ id: "42", title: "Edytor" }] })), focusWindow } });
    expect(JSON.parse(await listWindowsOnPc()).windows[0]).toEqual({ id: "42", title: "Edytor" });
    expect(JSON.parse(await focusWindowOnPc("42", "Edytor"))).toEqual({ ok: false, error: "err:linux-window-mismatch" });
    expect(focusWindow).toHaveBeenCalledWith("42", "Edytor");
  });
});
