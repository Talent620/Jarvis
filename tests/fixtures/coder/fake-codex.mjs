#!/usr/bin/env node
// A stand-in for the Codex CLI in tests (no network, no model): it answers `--version`,
// `login status` and `exec --json` like the real CLI, following a JSON scenario given in
// JARVIS_FAKE_CODER_SCRIPT. It records its argv, stdin prompt and environment keys so tests can
// check what JARVIS handed to the agent.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const scenarioFile = process.env.JARVIS_FAKE_CODER_SCRIPT;
const scenario = scenarioFile ? JSON.parse(readFileSync(scenarioFile, "utf8")) : {};
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args[0] === "--version") { console.log("codex-cli 0.157.0"); process.exit(0); }
if (args[0] === "login" && args[1] === "status") {
  if (scenario.loggedIn === false) { console.log("Not logged in"); process.exit(1); }
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
if (args[0] !== "exec") { console.error("unsupported"); process.exit(2); }

const resume = args[1] === "resume";
const cdIdx = args.indexOf("-C");
const root = cdIdx >= 0 ? args[cdIdx + 1] : process.cwd();
let prompt = "";
process.stdin.on("data", (d) => { prompt += d; });
await new Promise((r) => process.stdin.on("end", r));

if (scenario.record) {
  appendFileSync(scenario.record, `${JSON.stringify({ args, prompt, cwd: process.cwd(), envKeys: Object.keys(process.env).sort() })}\n`);
}
if (scenario.ignoreSigint) process.on("SIGINT", () => {});
if (scenario.ignoreSigterm) process.on("SIGTERM", () => {});
if (scenario.grandchild) {
  const g = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  writeFileSync(scenario.grandchild, String(g.pid));
}

const steps = resume ? scenario.resumeSteps ?? scenario.steps ?? [] : scenario.steps ?? [];
out({ type: "thread.started", thread_id: scenario.threadId ?? "thread-fake-1" });
out({ type: "turn.started" });
let n = 0;
for (const s of steps) {
  const id = `item_${++n}`;
  if (s.type === "sleep") await sleep(s.ms);
  else if (s.type === "reasoning") out({ type: "item.completed", item: { id, type: "reasoning", text: s.text } });
  else if (s.type === "message") out({ type: "item.completed", item: { id, type: "agent_message", text: s.text } });
  else if (s.type === "write") {
    const target = resolve(root, s.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, s.content);
    out({ type: "item.completed", item: { id, type: "file_change", changes: [{ path: s.report ?? target, kind: "update" }], status: "completed" } });
  } else if (s.type === "cmd") {
    out({ type: "item.started", item: { id, type: "command_execution", command: `bash -lc '${s.command}'`, aggregated_output: "", exit_code: null, status: "in_progress" } });
    let exit = s.exit ?? 0;
    let output = s.output ?? "";
    if (s.run) {
      const [c, ...a] = s.run;
      const r = spawnSync(c, a, { cwd: root, encoding: "utf8" });
      exit = r.status ?? 1;
      output = `${r.stdout}${r.stderr}`;
    }
    out({ type: "item.completed", item: { id, type: "command_execution", command: `bash -lc '${s.command}'`, aggregated_output: output, exit_code: exit, status: exit === 0 ? "completed" : "failed" } });
  } else if (s.type === "crash") process.exit(s.code ?? 3);
  else if (s.type === "raw") process.stdout.write(`${s.line}\n`);
}
if (scenario.final === "failure") { out({ type: "turn.failed", error: { message: "model error" } }); process.exit(1); }
out({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
process.exit(0);
