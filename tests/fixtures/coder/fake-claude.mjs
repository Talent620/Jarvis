#!/usr/bin/env node
// A stand-in for Claude Code in tests: `--version`, and `-p --input-format stream-json
// --output-format stream-json`. Every user message on stdin is one turn; the scenario's steps run
// on the first turn, later messages are recorded (instructions sent while it works).
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const scenario = process.env.JARVIS_FAKE_CODER_SCRIPT ? JSON.parse(readFileSync(process.env.JARVIS_FAKE_CODER_SCRIPT, "utf8")) : {};
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (args[0] === "--version") { console.log("2.1.282 (Claude Code)"); process.exit(0); }

// "runs": a different script per session (e.g. the reviewer's first and second look).
if (Array.isArray(scenario.runs)) {
  const counter = `${process.env.JARVIS_FAKE_CODER_SCRIPT}.runs`;
  let n = 0;
  try { n = Number(readFileSync(counter, "utf8")) || 0; } catch { n = 0; }
  writeFileSync(counter, String(n + 1));
  Object.assign(scenario, scenario.runs[Math.min(n, scenario.runs.length - 1)] ?? {});
}
out({ type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-test-model", tools: ["Read", "Edit", "Bash"] });
const rl = createInterface({ input: process.stdin });
let turn = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  const text = msg.message.content.map((c) => c.text).join("");
  if (scenario.record) appendFileSync(scenario.record, `${JSON.stringify({ args, text, cwd: process.cwd(), envKeys: Object.keys(process.env).sort() })}\n`);
  turn++;
  if (turn === 1) {
    for (const s of scenario.steps ?? []) {
      if (s.type === "sleep") await sleep(s.ms);
      else if (s.type === "message") out({ type: "assistant", message: { content: [{ type: "text", text: s.text }] } });
      else if (s.type === "write") {
        const target = resolve(process.cwd(), s.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, s.content);
        out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: target } }] } });
      } else if (s.type === "bash") {
        out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: s.command } }] } });
        out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: s.output ?? "" }] } });
      }
    }
  } else {
    out({ type: "assistant", message: { content: [{ type: "text", text: `ok: ${text}` }] } });
  }
  out({ type: "result", subtype: "success", is_error: false, result: turn === 1 ? scenario.final ?? "done" : `handled: ${text}`, session_id: "claude-session-1" });
}
process.exit(0);
