// Agent output -> JARVIS coder events (M11). Codex `exec --json` (item events, and the older
// `msg` events of earlier versions) and Claude Code `--output-format stream-json`. Unknown lines
// are ignored, never guessed at: logic never depends on one CLI's colored terminal text.

import type { CoderEventKind } from "../../lib/runtime/coder/types";

export interface ParsedEvent {
  kind: CoderEventKind;
  text: string;
  file?: string;
  command?: string;
  exitCode?: number;
  tests?: { passed: number; failed: number };
  sessionId?: string;
  model?: string;
  /** The agent's final message (its own claim, not proof). */
  final?: string;
  /** The agent ended its turn: success or failure as it reports it. */
  end?: "success" | "failure";
}

const TEST = /\b(vitest|jest|mocha|pytest|cargo test|go test|npm (?:run )?test|pnpm (?:run )?test|yarn test|node --test|ctest|phpunit|rspec|dotnet test)\b/;
const BUILD = /\b(tsc|npm run build|pnpm (?:run )?build|yarn build|vite build|webpack|cargo build|go build|make(?: [\w-]+)?|gradle|mvn|dotnet build|electron-builder)\b/;
const SEARCH = /^(?:rg|grep|ag|find|fd|git grep)\b/;
const READ = /^(?:cat|sed -n|head|tail|less|nl|bat|wc)\b/;

/** Strip the shell wrapper agents put around commands ("bash -lc '...'"). */
export function unwrapCommand(cmd: string): string {
  const m = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh\s+-l?c\s+([\s\S]*)$/.exec(cmd.trim());
  if (!m) return cmd.trim();
  const inner = m[1].trim();
  const q = /^(['"])([\s\S]*)\1$/.exec(inner);
  return (q ? q[2] : inner).trim();
}

export function classifyCommand(raw: string): CoderEventKind {
  const cmd = unwrapCommand(raw);
  if (TEST.test(cmd)) return "RUNNING_TEST";
  if (BUILD.test(cmd)) return "BUILDING";
  if (/^git\b/.test(cmd)) return "GIT_OPERATION";
  if (SEARCH.test(cmd)) return "SEARCHING";
  if (READ.test(cmd)) return "READING_FILE";
  return "RUNNING_COMMAND";
}

/** Test totals from a runner summary line (vitest, jest, pytest, cargo, node --test, mocha). */
export function testCounts(output: string): { passed: number; failed: number } | undefined {
  // eslint-disable-next-line no-control-regex -- ANSI color codes in runner output
  const s = output.replace(/\x1b\[[0-9;]*m/g, "");
  let m = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed/.exec(s); // vitest
  if (m) return { passed: Number(m[2]), failed: Number(m[1] ?? 0) };
  m = /Tests:\s+(?:(\d+)\s+failed,\s+)?(?:\d+\s+skipped,\s+)?(\d+)\s+passed/.exec(s); // jest
  if (m) return { passed: Number(m[2]), failed: Number(m[1] ?? 0) };
  m = /(?:=+\s*)?(?:(\d+)\s+failed,\s+)?(\d+)\s+passed(?:,\s+(\d+)\s+failed)?[^\n]*in\s+[\d.]+s/.exec(s); // pytest
  if (m) return { passed: Number(m[2]), failed: Number(m[1] ?? m[3] ?? 0) };
  m = /test result: \w+\. (\d+) passed; (\d+) failed/.exec(s); // cargo
  if (m) return { passed: Number(m[1]), failed: Number(m[2]) };
  const pass = /^# pass (\d+)$/m.exec(s); // node --test (TAP)
  const fail = /^# fail (\d+)$/m.exec(s);
  if (pass && fail) return { passed: Number(pass[1]), failed: Number(fail[1]) };
  m = /(\d+) passing[\s\S]*?(?:(\d+) failing)?/.exec(s); // mocha
  if (m && /passing/.test(s)) return { passed: Number(m[1]), failed: Number(m[2] ?? 0) };
  return undefined;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function jsonLine(line: string): Record<string, unknown> | null {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try { return obj(JSON.parse(t)); } catch { return null; }
}

// ------------------------------------------------------------------------------------ Codex

/** One line of `codex exec --json`. Returns [] for lines that carry nothing JARVIS uses. */
export function parseCodexLine(line: string): ParsedEvent[] {
  const m = jsonLine(line);
  if (!m) return [];
  const type = str(m.type);
  // Current format: thread / turn / item events.
  if (type === "thread.started") return [{ kind: "TASK_STARTED", text: "Codex started", sessionId: str(m.thread_id) }];
  if (type === "turn.started") return [{ kind: "PLANNING", text: "Codex is working" }];
  if (type === "turn.completed") return [{ kind: "MESSAGE", text: "Codex finished its turn", end: "success" }];
  if (type === "turn.failed") return [{ kind: "ERROR", text: `Codex failed: ${str(obj(m.error)?.message) ?? "unknown error"}`, end: "failure" }];
  if (type === "error") return [{ kind: "ERROR", text: `Codex error: ${str(m.message) ?? "unknown"}` }];
  if (type === "item.started" || type === "item.updated" || type === "item.completed") {
    const item = obj(m.item);
    if (!item) return [];
    const done = type === "item.completed";
    switch (str(item.type)) {
      case "command_execution": {
        const command = str(item.command) ?? "";
        const exit = typeof item.exit_code === "number" ? item.exit_code : undefined;
        const out = str(item.aggregated_output) ?? "";
        const kind = classifyCommand(command);
        if (!done) return type === "item.started" ? [{ kind, text: unwrapCommand(command), command: unwrapCommand(command) }] : [];
        return [{ kind, text: `${unwrapCommand(command)} -> exit ${exit ?? "?"}`, command: unwrapCommand(command), exitCode: exit, tests: kind === "RUNNING_TEST" ? testCounts(out) : undefined }];
      }
      case "file_change": {
        const changes = Array.isArray(item.changes) ? item.changes.map(obj).filter(Boolean) as Record<string, unknown>[] : [];
        if (type === "item.started") return [];
        return changes.map((c) => ({ kind: "EDITING_FILE" as const, text: `${str(c.kind) ?? "update"} ${str(c.path) ?? "?"}`, file: str(c.path) }));
      }
      case "agent_message":
        return done ? [{ kind: "MESSAGE", text: str(item.text) ?? "", final: str(item.text) }] : [];
      case "reasoning":
        return done ? [{ kind: "PLANNING", text: (str(item.text) ?? "").split("\n")[0].replace(/\*/g, "").slice(0, 160) }] : [];
      case "todo_list": {
        const items = Array.isArray(item.items) ? item.items.map(obj).filter(Boolean) as Record<string, unknown>[] : [];
        const next = items.find((x) => x.completed !== true);
        return next ? [{ kind: "PLANNING", text: `plan: ${str(next.text) ?? ""}` }] : [];
      }
      case "mcp_tool_call":
        return type === "item.started" ? [{ kind: "RUNNING_COMMAND", text: `tool ${str(item.server) ?? ""}.${str(item.tool) ?? ""}` }] : [];
      case "web_search":
        return type === "item.started" ? [{ kind: "SEARCHING", text: `web: ${str(item.query) ?? ""}` }] : [];
      case "error":
        return [{ kind: "WARNING", text: str(item.message) ?? "warning" }];
      default:
        return [];
    }
  }
  // Earlier versions: {"id":..,"msg":{"type":"exec_command_begin",...}}
  const msg = obj(m.msg);
  if (msg) {
    switch (str(msg.type)) {
      case "session_configured": return [{ kind: "TASK_STARTED", text: "Codex started", sessionId: str(msg.session_id), model: str(msg.model) }];
      case "exec_command_begin": {
        const cmd = Array.isArray(msg.command) ? msg.command.map(String).join(" ") : str(msg.command) ?? "";
        return [{ kind: classifyCommand(cmd), text: unwrapCommand(cmd), command: unwrapCommand(cmd) }];
      }
      case "exec_command_end": {
        const exit = typeof msg.exit_code === "number" ? msg.exit_code : undefined;
        const out = `${str(msg.stdout) ?? ""}\n${str(msg.aggregated_output) ?? ""}`;
        const t = testCounts(out);
        return [{ kind: t ? "RUNNING_TEST" : "RUNNING_COMMAND", text: `command -> exit ${exit ?? "?"}`, exitCode: exit, tests: t }];
      }
      case "patch_apply_begin": {
        const files = obj(msg.changes) ? Object.keys(obj(msg.changes)!) : [];
        return files.map((f) => ({ kind: "EDITING_FILE" as const, text: `update ${f}`, file: f }));
      }
      case "agent_message": return [{ kind: "MESSAGE", text: str(msg.message) ?? "", final: str(msg.message) }];
      case "task_complete": return [{ kind: "MESSAGE", text: "Codex finished its turn", end: "success", final: str(msg.last_agent_message) }];
      case "error": return [{ kind: "ERROR", text: `Codex error: ${str(msg.message) ?? "unknown"}`, end: "failure" }];
      default: return [];
    }
  }
  return [];
}

// ------------------------------------------------------------------------------ Claude Code

const CLAUDE_TOOL: Record<string, CoderEventKind> = {
  Read: "READING_FILE", Grep: "SEARCHING", Glob: "SEARCHING", LS: "SEARCHING", WebSearch: "SEARCHING", WebFetch: "SEARCHING",
  Edit: "EDITING_FILE", MultiEdit: "EDITING_FILE", Write: "EDITING_FILE", NotebookEdit: "EDITING_FILE",
  TodoWrite: "PLANNING", Task: "PLANNING",
};

/** One line of `claude -p --output-format stream-json --verbose`. */
export function parseClaudeLine(line: string): ParsedEvent[] {
  const m = jsonLine(line);
  if (!m) return [];
  const type = str(m.type);
  if (type === "system" && str(m.subtype) === "init") return [{ kind: "TASK_STARTED", text: "Claude Code started", sessionId: str(m.session_id), model: str(m.model) }];
  if (type === "result") {
    const ok = str(m.subtype) === "success" && m.is_error !== true;
    const res = str(m.result);
    return [{ kind: ok ? "MESSAGE" : "ERROR", text: ok ? "Claude Code finished its turn" : `Claude Code stopped: ${str(m.subtype) ?? "error"}`, end: ok ? "success" : "failure", final: res, sessionId: str(m.session_id) }];
  }
  const message = obj(m.message);
  const content = Array.isArray(message?.content) ? (message!.content as unknown[]).map(obj).filter(Boolean) as Record<string, unknown>[] : [];
  const out: ParsedEvent[] = [];
  if (type === "assistant") {
    for (const c of content) {
      if (c.type === "text" && str(c.text)?.trim()) out.push({ kind: "MESSAGE", text: str(c.text)!.trim() });
      if (c.type === "tool_use") {
        const name = str(c.name) ?? "tool";
        const input = obj(c.input) ?? {};
        if (name === "Bash") {
          const command = str(input.command) ?? "";
          out.push({ kind: classifyCommand(command), text: command, command });
        } else {
          const file = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path);
          const kind = CLAUDE_TOOL[name] ?? "RUNNING_COMMAND";
          out.push({ kind, text: `${name}${file ? ` ${file}` : str(input.pattern) ? ` ${str(input.pattern)}` : ""}`, file });
        }
      }
    }
  }
  if (type === "user") {
    for (const c of content) {
      if (c.type !== "tool_result") continue;
      const text = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? (c.content as unknown[]).map((x) => str(obj(x)?.text) ?? "").join("\n") : "";
      const t = testCounts(text);
      if (t) out.push({ kind: "RUNNING_TEST", text: `tests: ${t.passed} passed, ${t.failed} failed`, tests: t });
      if (c.is_error === true) out.push({ kind: "WARNING", text: text.split("\n")[0].slice(0, 200) });
    }
  }
  return out;
}
