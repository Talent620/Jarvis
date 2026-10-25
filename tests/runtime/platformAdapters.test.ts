// Windows UI Automation and Android accessibility adapters (M9) behind the ComputerEnvironment
// contract, with a scripted PowerShell runner and a fake accessibility device. Real Windows and
// Android runs are NEEDS_HARDWARE here.
import { describe, it, expect } from "vitest";
import { WindowsDesktopEnvironment, sendKeysCombo, sendKeysText, uiaInvocation } from "../../src/node/windows/uia";
import { AndroidEnvironment, type AndroidDevice } from "../../src/lib/runtime/env/android";
import { Kernel } from "../../src/lib/runtime/kernel";
import { performAction } from "../../src/lib/runtime/actions";
import type { ComputerEnvironment } from "../../src/lib/runtime/env/types";
import type { Run } from "../../src/node/linux/runner";

function decode(args: string[]): { cmd: string; params: Record<string, unknown>; script: string } {
  const script = Buffer.from(args[args.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le");
  const m = /Invoke-Jarvis '(\w+)' '([A-Za-z0-9+/=]*)'/.exec(script)!;
  return { cmd: m[1], params: JSON.parse(Buffer.from(m[2], "base64").toString("utf8")), script };
}

async function kernelFor(env: ComputerEnvironment) {
  const k = new Kernel();
  k.dispatch({ type: "CapabilitiesUpdated", capabilities: await env.capabilities() });
  k.dispatch({ type: "TaskCreated", taskId: "T", goal: "g", kind: "k" });
  return k;
}

describe("Windows UI Automation adapter", () => {
  it("user text only travels as base64 JSON, never as PowerShell code", () => {
    const evil = `'); Remove-Item C:\\ -Recurse; $(calc) "`;
    const { cmd, params, script } = decode(uiaInvocation("clipboardSet", { text: evil }));
    expect(cmd).toBe("clipboardSet");
    expect(params).toEqual({ text: evil });
    expect(script).not.toContain("Remove-Item C:");
    expect(uiaInvocation("focused")).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-EncodedCommand"]));
  });

  it("SendKeys: special characters typed literally, combos mapped", () => {
    expect(sendKeysText("a+b (c) {d} 50% ~^")).toBe("a{+}b {(}c{)} {{}d{}} 50{%} {~}{^}");
    expect(sendKeysText("Łódź\nnocą")).toBe("Łódź{ENTER}nocą");
    expect(sendKeysCombo("ctrl+c")).toBe("^c");
    expect(sendKeysCombo("shift+End")).toBe("+{END}");
    expect(sendKeysCombo("ctrl+shift+v")).toBe("^+v");
  });

  it("select, copy and window switch are confirmed by UIA and clipboard read-backs", async () => {
    let clip = "";
    let active = "0x00010001";
    let selection = "";
    const run: Run = async (_cmd, args) => {
      const { cmd, params } = decode(args);
      const out = (o: unknown) => ({ code: 0, stdout: JSON.stringify(o), stderr: "" });
      switch (cmd) {
        case "window": return out({ found: true, id: active, title: active === "0x00010001" ? "YouTube - Edge" : "Notatnik", app: "msedge", pid: 4 });
        case "windows": return out({ windows: [{ id: "0x00010001", title: "YouTube - Edge", app: "msedge" }, { id: "0x00020002", title: "Notatnik", app: "notepad" }] });
        case "activate": active = String(params.id); return out({ ok: true });
        case "focused": return out({ found: true, role: "ControlType.Edit", name: "", app: "notepad", text: "Łódź nocą", selection });
        case "select": selection = "Łódź nocą".slice(Number(params.start), Number(params.end)); return out({ ok: true, selection });
        case "keys": if (params.keys === "^c") clip = selection; return out({ ok: true });
        case "clipboardGet": return out({ ok: true, text: clip });
        case "clipboardSet": clip = String(params.text); return out({ ok: true });
        default: return out({ error: "unknown" });
      }
    };
    const env = new WindowsDesktopEnvironment({ run, settleMs: 0 });
    const k = await kernelFor(env);
    expect((await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "window.activate", windowId: "0x00020002" } })).truth).toBe("CONFIRMED");
    expect((await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "text.select", target: { ref: "uia:focused" }, start: 0, end: 4, expected: "Łódź" } })).truth).toBe("CONFIRMED");
    expect((await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "clipboard.copy", expected: "Łódź" } })).truth).toBe("CONFIRMED");
    expect(await env.read({ kind: "windows" })).toMatchObject({ windows: [{ title: "YouTube - Edge" }, { title: "Notatnik" }] });
  });

  it("off Windows with no runner: every capability is NEEDS_HARDWARE", async () => {
    if (process.platform === "win32") return;
    const caps = await new WindowsDesktopEnvironment().capabilities();
    expect(caps.every((c) => c.status === "needs_hardware")).toBe(true);
  });
});

describe("Android accessibility adapter", () => {
  function device(over: Partial<AndroidDevice> & { enabled?: boolean; clipboardReadable?: boolean } = {}) {
    const state = { text: "Łódź nocą", sel: [0, 0] as [number, number], clip: "" };
    const d: AndroidDevice = {
      isEnabled: async () => ({ enabled: over.enabled ?? true }),
      focused: async () => ({ found: true, text: state.text, role: "android.widget.EditText", app: "com.google.android.youtube", editable: true, selection: state.text.slice(...state.sel) }),
      activeWindow: async () => ({ found: true, id: "12", title: "YouTube", app: "com.google.android.youtube" }),
      windows: async () => ({ windows: [{ id: "12", title: "YouTube", app: "com.google.android.youtube", active: true }] }),
      select: async ({ start, end }) => { state.sel = [start, end]; return { ok: true }; },
      copy: async () => { state.clip = state.text.slice(...state.sel); return { ok: true }; },
      appendText: async ({ text }) => { state.text += text; return { ok: true }; },
      scroll: async () => ({ ok: true }),
      tree: async () => ({ nodes: [{ cls: "android.widget.TextView", text: "Łódź to miasto", desc: "", id: "com.google.android.youtube:id/comment_text", clickable: false, editable: false, scrollable: false, bounds: "0,0,1,1" }] }),
      getClipboard: async () => (over.clipboardReadable === false ? { ok: false, error: "not in the foreground" } : { ok: true, text: state.clip }),
      setClipboard: async ({ text }) => { state.clip = text; return { ok: true }; },
      ...over,
    };
    return d;
  }

  it("service off: NEEDS_PERMISSION with the setting to turn on", async () => {
    const env = new AndroidEnvironment(device({ enabled: false }));
    expect((await env.capabilities())[0]).toMatchObject({ id: "android.accessibility.tree", status: "needs_permission" });
    const k = await kernelFor(env);
    expect((await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "text.select", target: { ref: "android:focused" }, start: 0, end: 4, expected: "Łódź" } })).truth).toBe("NEEDS_PERMISSION");
  });

  it("select and copy confirmed while JARVIS can read the clipboard; typing confirmed by the node text", async () => {
    const env = new AndroidEnvironment(device());
    const k = await kernelFor(env);
    expect((await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "text.select", target: { ref: "android:focused" }, start: 0, end: 4, expected: "Łódź" } })).truth).toBe("CONFIRMED");
    expect((await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "clipboard.copy", expected: "Łódź" } })).truth).toBe("CONFIRMED");
    expect((await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "desktop.type", text: " wieczorem" } })).truth).toBe("CONFIRMED");
    expect(await env.snapshot()).toBe('TextView "Łódź to miasto" #comment_text');
  });

  it("copy from another app with the clipboard unreadable is ATTEMPTED, never CONFIRMED or FAILED", async () => {
    const env = new AndroidEnvironment(device({ clipboardReadable: false }));
    const k = await kernelFor(env);
    await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "text.select", target: { ref: "android:focused" }, start: 0, end: 4, expected: "Łódź" } });
    const r = await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "clipboard.copy", expected: "Łódź" } });
    expect(r.truth).toBe("ATTEMPTED");
    expect(r.reason).toMatch(/clipboard unreadable: not in the foreground/);
  });

  it("outside the Android app: NEEDS_HARDWARE", async () => {
    const env = new AndroidEnvironment(null);
    expect((await env.capabilities())[0].status).toBe("needs_hardware");
    expect((await env.act({ kind: "clipboard.copy", expected: "x" })).status).toBe("needs_capability");
  });
});
