// Windows desktop through UI Automation (mission M9): a PowerShell helper on
// System.Windows.Automation for the focused element, TextPattern selection, windows, the
// clipboard and keys. Parameters travel as base64 JSON inside -EncodedCommand, so user text is
// data and never PowerShell code. Semantic primitives first; pixels are not used.

import type {
  ActResult, ClipboardRead, ComputerEnvironment, EnvAction, EnvEvent, FocusedRead, ReadQuery, ReadResult, SelectionRead, WindowListRead, WindowRead,
} from "../../lib/runtime/env/types";
import type { CapabilityState } from "../../lib/runtime/types";
import { execRunner, type Run } from "../linux/runner";

export const UIA_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class JarvisWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$A = [System.Windows.Automation.AutomationElement]
$TP = [System.Windows.Automation.TextPattern]
function ProcName($procId) { try { (Get-Process -Id $procId).ProcessName } catch { '' } }
function TextOf($el) {
  try { $p = $el.GetCurrentPattern($TP::Pattern); return $p.DocumentRange.GetText(2000) } catch {}
  try { $v = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); return $v.Current.Value } catch {}
  return $null
}
function SelectionOf($el) {
  try { $p = $el.GetCurrentPattern($TP::Pattern); $s = $p.GetSelection(); if ($s.Length -gt 0) { return $s[0].GetText(2000) } } catch {}
  return ''
}
function Invoke-Jarvis([string]$cmd, [string]$b64) {
  $p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) | ConvertFrom-Json
  switch ($cmd) {
    'focused' {
      $el = $A::FocusedElement
      if (-not $el) { return @{ found = $false } }
      return @{ found = $true; role = $el.Current.ControlType.ProgrammaticName; name = $el.Current.Name; app = (ProcName $el.Current.ProcessId); text = (TextOf $el); selection = (SelectionOf $el) }
    }
    'window' {
      $h = [JarvisWin]::GetForegroundWindow(); $sb = New-Object Text.StringBuilder 512
      [void][JarvisWin]::GetWindowText($h, $sb, 512); $procId = 0; [void][JarvisWin]::GetWindowThreadProcessId($h, [ref]$procId)
      return @{ found = ($h -ne [IntPtr]::Zero); id = ('0x{0:x8}' -f $h.ToInt64()); title = $sb.ToString(); app = (ProcName $procId); pid = $procId }
    }
    'windows' {
      $all = $A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
      $list = @(); foreach ($w in $all) { if ($w.Current.Name) { $list += @{ id = ('0x{0:x8}' -f [int64]$w.Current.NativeWindowHandle); title = $w.Current.Name; app = (ProcName $w.Current.ProcessId); pid = $w.Current.ProcessId } } }
      return @{ windows = $list }
    }
    'activate' {
      $h = [IntPtr][Convert]::ToInt64($p.id, 16); [void][JarvisWin]::ShowWindow($h, 9); return @{ ok = [JarvisWin]::SetForegroundWindow($h) }
    }
    'select' {
      $el = $A::FocusedElement; $tp = $el.GetCurrentPattern($TP::Pattern)
      $r = $tp.DocumentRange.Clone()
      [void]$r.MoveEndpointByRange([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, $r, [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
      [void]$r.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, [System.Windows.Automation.Text.TextUnit]::Character, [int]$p.end)
      [void]$r.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, [System.Windows.Automation.Text.TextUnit]::Character, [int]$p.start)
      $r.Select(); return @{ ok = $true; selection = (SelectionOf $el) }
    }
    'clipboardGet' { return @{ ok = $true; text = [string](Get-Clipboard -Raw) } }
    'clipboardSet' { Set-Clipboard -Value ([string]$p.text); return @{ ok = $true } }
    'keys' { [System.Windows.Forms.SendKeys]::SendWait([string]$p.keys); return @{ ok = $true } }
    default { return @{ error = 'unknown command' } }
  }
}
`;

export type UiaCommand = "focused" | "window" | "windows" | "activate" | "select" | "clipboardGet" | "clipboardSet" | "keys";

/** The PowerShell command line for one helper call; user data only inside the base64 JSON. */
export function uiaInvocation(cmd: UiaCommand, params: Record<string, unknown> = {}): string[] {
  const b64 = Buffer.from(JSON.stringify(params), "utf8").toString("base64");
  const script = `${UIA_HELPER}\ntry { Invoke-Jarvis '${cmd}' '${b64}' | ConvertTo-Json -Compress -Depth 4 } catch { @{ error = $_.Exception.Message } | ConvertTo-Json -Compress }`;
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

const SENDKEYS_SPECIAL = /[+^%~(){}[\]]/g;
/** Text for SendKeys: special characters are wrapped in braces so they are typed literally. */
export const sendKeysText = (text: string): string => text.replace(SENDKEYS_SPECIAL, (c) => `{${c}}`).replace(/\n/g, "{ENTER}");

const KEY_NAMES: Record<string, string> = { enter: "{ENTER}", return: "{ENTER}", esc: "{ESC}", escape: "{ESC}", tab: "{TAB}", backspace: "{BACKSPACE}", delete: "{DELETE}", home: "{HOME}", end: "{END}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}" };
/** "ctrl+c" -> "^c", "shift+End" -> "+{END}". */
export function sendKeysCombo(combo: string): string {
  let mods = "";
  let key = "";
  for (const part of combo.split("+")) {
    const k = part.toLowerCase();
    if (k === "ctrl" || k === "control") mods += "^";
    else if (k === "shift") mods += "+";
    else if (k === "alt") mods += "%";
    else key = KEY_NAMES[k] ?? (k.length === 1 ? sendKeysText(k) : `{${k.toUpperCase()}}`);
  }
  return `${mods}${key}`;
}

export class WindowsDesktopEnvironment implements ComputerEnvironment {
  readonly id = "windows-desktop";
  private readonly run: Run;
  constructor(private readonly o: { run?: Run; shell?: string; settleMs?: number } = {}) {
    this.run = o.run ?? execRunner;
  }

  private async call<T>(cmd: UiaCommand, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T & { error?: string }> {
    const r = await this.run(this.o.shell ?? "powershell.exe", uiaInvocation(cmd, params), { timeoutMs: 10_000, signal });
    if (signal?.aborted) return { error: "aborted" } as T & { error?: string };
    try {
      return JSON.parse(r.stdout.trim() || "{}") as T & { error?: string };
    } catch {
      return { error: r.stderr.trim().split("\n")[0] || `exit ${r.code}` } as T & { error?: string };
    }
  }

  async capabilities(): Promise<CapabilityState[]> {
    const at = Date.now();
    if (process.platform !== "win32" && !this.o.run) {
      return ["windows.uia", "desktop.clipboard", "desktop.active_window", "desktop.window_list"].map((id) => ({ id, status: "needs_hardware" as const, checkedAt: at, provider: this.id, detail: "Windows only" }));
    }
    const probe = await this.call<{ found?: boolean }>("window");
    const status = probe.error ? "missing" as const : "available" as const;
    return ["windows.uia", "desktop.clipboard", "desktop.active_window", "desktop.window_list"].map((id) => ({ id, status, checkedAt: at, provider: this.id, detail: probe.error }));
  }

  async act(action: EnvAction, signal?: AbortSignal): Promise<ActResult> {
    if (signal?.aborted) return { status: "failed", error: "aborted" };
    const settle = () => new Promise((r) => setTimeout(r, this.o.settleMs ?? 80));
    const done = async (r: { ok?: boolean; error?: string }) => { if (r.ok) { await settle(); return { status: "done" as const }; } return { status: "failed" as const, error: r.error ?? "UI Automation refused" }; };
    switch (action.kind) {
      case "clipboard.write": return done(await this.call("clipboardSet", { text: action.text }));
      case "clipboard.copy": return done(await this.call("keys", { keys: "^c" }));
      case "desktop.keys": return done(await this.call("keys", { keys: sendKeysCombo(action.keys) }, signal));
      case "desktop.type": return done(await this.call("keys", { keys: sendKeysText(action.text) }, signal));
      case "window.activate": return done(await this.call("activate", { id: action.windowId }));
      case "text.select":
        if (action.target.ref !== "uia:focused") return { status: "not_found", error: "desktop selection works on the focused element (uia:focused)" };
        return done(await this.call("select", { start: action.start, end: action.end }));
      default:
        return { status: "needs_capability", error: `${action.kind} is a browser action` };
    }
  }

  async read(q: ReadQuery): Promise<ReadResult> {
    switch (q.kind) {
      case "clipboard": {
        const r = await this.call<{ ok?: boolean; text?: string }>("clipboardGet");
        return r.error ? { ok: false, error: r.error } satisfies ClipboardRead : { ok: true, text: r.text ?? "" } satisfies ClipboardRead;
      }
      case "focused": {
        const r = await this.call<{ found?: boolean; role?: string; name?: string; app?: string; text?: string | null }>("focused");
        return r.error ? { found: false, error: r.error } : { found: !!r.found, role: r.role, name: r.name, app: r.app, text: r.text ?? undefined } satisfies FocusedRead;
      }
      case "selection": {
        const r = await this.call<{ found?: boolean; selection?: string }>("focused");
        return { text: r.selection ?? "", visible: !!r.selection, ref: "uia:focused" } satisfies SelectionRead;
      }
      case "window": {
        const r = await this.call<{ found?: boolean; id?: string; title?: string; app?: string; pid?: number }>("window");
        return r.error || !r.found ? { found: false, error: r.error } : { found: true, window: { id: r.id!, title: r.title ?? "", app: r.app, pid: r.pid } } satisfies WindowRead;
      }
      case "windows": {
        const r = await this.call<{ windows?: { id: string; title: string; app?: string; pid?: number }[] }>("windows");
        return { windows: r.windows ?? [], error: r.error } satisfies WindowListRead;
      }
      case "page": return { open: false };
      case "element": return { found: false };
      case "collection": return { count: 0, items: [] };
    }
  }

  onEvent(_l: (e: EnvEvent) => void): () => void {
    return () => undefined;
  }

  async close(): Promise<void> { /* nothing held open */ }
}
