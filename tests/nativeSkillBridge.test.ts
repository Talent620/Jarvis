// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeSkillCommand, bindNativeSkillGoal } from "../src/lib/desktop";
import { askJarvis } from "../src/lib/brain";
import { webcrypto } from "node:crypto";
import { nativeSkillsContext } from "../src/lib/skills";
import { runTool, registerTool, unregisterTool, toolDefs } from "../src/lib/tools";
import { clearOutboundScope, grantOutboundScope, hasOutboundScope, listRememberedConsents, requestConsent, revokeToolScopes, setConsentHandler } from "../src/lib/permissions";
import { store } from "../src/lib/store";

const original = { ...store.settings };
beforeEach(() => { localStorage.clear(); store.setSettings({ onDeviceOnly: true, requireConsentAlways: false }); });
afterEach(() => { delete (window as any).jarvisDesktop; vi.unstubAllGlobals(); clearOutboundScope(); setConsentHandler(null); unregisterTool("skill_effect_test"); store.setSettings(original); });
describe("native skill bridge and ordinary tool gate", () => {
  it("cannot grant policy or override task context through model arguments", async () => {
    const command = vi.fn(async () => ({ ok: true }));
    Object.assign(window, { jarvisDesktop: { skillCommand: command } });
    await expect(nativeSkillCommand({ action: "policy", trustedUserAction: true })).rejects.toThrow(/właściciel/);
    const controller = new AbortController();
    await nativeSkillCommand({ action: "run", id: "p/a@v", taskId: "stolen", trustedUserAction: true }, controller.signal);
    await nativeSkillCommand({ action: "resource", id: "p/a@v", path: "ref.md" }, controller.signal);
    expect(command.mock.calls[0][0]).toEqual({ action: "run", id: "p/a@v" });
    expect(command.mock.calls[0][1]).toBe(command.mock.calls[1][1]);
    expect(command.mock.calls[0][1]).not.toBe("stolen");
    expect(command.mock.calls[0][2]).toBe(false);
    expect(toolDefs.some(tool => /skill.*policy/.test(tool.name))).toBe(false);
  });
  it("cancels native in-flight work and rejects its late response", async () => {
    let resolve!: (value: { ok: boolean }) => void;
    const command = vi.fn(() => new Promise<{ ok: boolean }>(done => { resolve = done; }));
    const cancel = vi.fn(async () => ({ ok: true }));
    Object.assign(window, { jarvisDesktop: { skillCommand: command, skillCancel: cancel } });
    const controller = new AbortController();
    const work = nativeSkillCommand({ action: "run", id: "p/a@v" }, controller.signal);
    controller.abort(); resolve({ ok: true });
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledWith(command.mock.calls[0][1], command.mock.calls[0][3]);
  });
  it("revoked version prevents the next ordinary tool and new task remains independent", async () => {
    let revoked = false;
    Object.assign(window, { jarvisDesktop: { skillCommand: vi.fn(async request => request.action === "assert_task" && revoked ? { ok: false, error: "VERSION_REVOKED" } : { ok: true }) } });
    const signal = new AbortController().signal;
    await nativeSkillCommand({ action: "run", id: "p/a@v" }, signal);
    const effect = vi.fn(() => "effect"); registerTool({ name: "skill_effect_test", description: "test", input_schema: {} }, effect);
    grantOutboundScope(["skill_effect_test"]);
    revoked = true;
    await expect(runTool("skill_effect_test", {}, { signal })).rejects.toThrow("VERSION_REVOKED");
    expect(effect).not.toHaveBeenCalled();
    expect(await runTool("skill_effect_test", {}, { signal: new AbortController().signal })).toBe("effect");
  });
  it("loads bounded matching active metadata, not inactive catalog procedures", async () => {
    Object.assign(window, { jarvisDesktop: { skillCommand: vi.fn(async () => ({ ok: true, skills: [
      { id: "p/csv@1", name: "csv", description: "csv analysis", state: "ACTIVE", hash: "a", codeKind: "instructions", instructions: "DO NOT INJECT" },
      { id: "p/csv@2", name: "csv", description: "csv analysis", state: "QUARANTINED", hash: "b" },
      { id: "p/calendar@1", name: "calendar", description: "calendar", state: "ACTIVE", hash: "c" },
    ] })) } });
    const context = await nativeSkillsContext("analizuj csv");
    expect(context).toContain("p/csv@1"); expect(context).not.toContain("p/csv@2"); expect(context).not.toContain("p/calendar@1"); expect(context).not.toContain("DO NOT INJECT");
  });
  it("integration revoke removes persistent and named grants", async () => {
    localStorage.setItem("jarvis.consents.v1", JSON.stringify({ mcp_old: "allow", other: "allow" }));
    grantOutboundScope(["mcp_old", "other"]); revokeToolScopes(["mcp_old"]);
    expect(hasOutboundScope("mcp_old")).toBe(false); expect(hasOutboundScope("other")).toBe(true);
    expect(listRememberedConsents()).toEqual(["other"]);
    expect(await requestConsent("mcp_old", {})).toBe(false);
  });
  it("revocation during a pending ordinary consent blocks dispatch after Allow", async () => {
    let revoked = false;
    Object.assign(window, { jarvisDesktop: { skillCommand: vi.fn(async request => request.action === "assert_task" && revoked ? { ok: false, error: "VERSION_REVOKED" } : { ok: true }) } });
    const signal = new AbortController().signal;
    await nativeSkillCommand({ action: "run", id: "p/a@v" }, signal);
    const effect = vi.fn(() => "effect"); registerTool({ name: "skill_effect_test", description: "test", input_schema: {} }, effect);
    let decide: ((answer: { allow: boolean; remember: boolean }) => void) | undefined;
    setConsentHandler(() => new Promise(resolve => { decide = resolve; }));
    const work = runTool("skill_effect_test", {}, { signal });
    await vi.waitFor(() => expect(decide).toBeTypeOf("function")); revoked = true; decide!({ allow: true, remember: false });
    expect(await work).toContain("VERSION_REVOKED"); expect(effect).not.toHaveBeenCalled();
  });
  it("provider attempt pins are released by the outer normal chat lifecycle", async () => {
    const calls: Array<{ request: Record<string, unknown>; taskId: string }> = [];
    const release = vi.fn(async () => ({ ok: true }));
    Object.assign(window, { jarvisDesktop: { skillCommand: async (request: Record<string, unknown>, taskId: string) => { calls.push({ request, taskId }); return request.action === "list" ? { ok: true, skills: [] } : { ok: true, kind: "instructions", instructions: "Return the computed result", taskCompleted: false }; }, skillRelease: release } });
    store.setSettings({ provider: "ollama", model: "qa-controlled", ollamaUrl: "http://localhost:11434", ollamaNumCtx: 32768, deepThink: false, expertKnowledge: false, interpreterMode: false, webSearch: false, confidenceGate: false, speculativeMode: false, memoryServiceUrl: "" });
    let turn = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: turn++ === 0 ? { role: "assistant", content: "", tool_calls: [{ function: { name: "skill_run", arguments: { id: "p/a@v" } } }] } : { role: "assistant", content: "Kontrolowana odpowiedź." } }))));
    await askJarvis([{ role: "user", content: "Użyj umiejętności do przeliczenia wartości." }]);
    const execution = calls.find(call => call.request.action === "run")!;
    expect(execution).toBeTruthy(); expect(release).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledWith(execution.taskId);
  });
  it("persisted goal identity binds the same version set across independent resume signals", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const command = vi.fn(async () => ({ ok: true })); Object.assign(window, { jarvisDesktop: { skillCommand: command } });
    const first = new AbortController().signal, resumed = new AbortController().signal;
    await bindNativeSkillGoal(first, "long-goal-".repeat(40)); await bindNativeSkillGoal(resumed, "long-goal-".repeat(40));
    await nativeSkillCommand({ action: "run", id: "p/a@v" }, first); await nativeSkillCommand({ action: "assert_task" }, resumed);
    expect(command.mock.calls[0][1]).toBe(command.mock.calls[1][1]); expect(command.mock.calls[0][1]).toMatch(/^skill-goal-[a-f0-9]{64}$/);
  });
});
