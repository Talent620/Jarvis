import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { createSkillIsolation, hashSkillDirectory, readSkillFile, limitsOf } = require("../electron/skill-isolation.cjs");
const directories: string[] = [];
function skill(code: string) {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-isolation-test-")); directories.push(directory);
  writeFileSync(join(directory, "run.cjs"), code);
  return { directory, entrypoint: "run.cjs", hash: hashSkillDirectory(directory) };
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("skill snapshot boundary", () => {
  it("has a deterministic content hash including relative paths and UTF-8 bytes", () => {
    const a = skill("console.log('żółć')"), b = skill("console.log('żółć')");
    expect(a.hash).toBe(b.hash);
    mkdirSync(join(a.directory, "references")); writeFileSync(join(a.directory, "references", "a.txt"), "źródło");
    expect(hashSkillDirectory(a.directory)).not.toBe(b.hash);
  });
  it("rejects symlinks and hardlinks instead of following data outside the skill", () => {
    const a = skill(""), b = skill("synthetic outside secret");
    symlinkSync(join(b.directory, "run.cjs"), join(a.directory, "leak"));
    expect(() => hashSkillDirectory(a.directory)).toThrow(/Dowiązania/);
    rmSync(join(a.directory, "leak"));
    linkSync(join(b.directory, "run.cjs"), join(a.directory, "leak"));
    expect(() => hashSkillDirectory(a.directory)).toThrow(/dowiązanie/);
  });
  it("rejects oversize/deep packages and cannot raise the host policy's limits", () => {
    const a = skill(""); writeFileSync(join(a.directory, "large"), Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(() => hashSkillDirectory(a.directory)).toThrow(/limit/);
    expect(() => limitsOf({ memoryMb: 8192 })).toThrow(/limit/);
    expect(() => limitsOf({ timeoutMs: Infinity })).toThrow(/limit/);
    expect(limitsOf({ timeoutMs: 100 })).toMatchObject({ timeoutMs: 100, cpuSeconds: 2 });
  });
  it("pins every absolute ancestor and bounds individual source reads", () => {
    const a = skill("small"), b = skill("");
    mkdirSync(join(a.directory, "nested")); writeFileSync(join(a.directory, "nested", "read.cjs"), "bounded");
    symlinkSync(a.directory, join(b.directory, "parent"));
    expect(() => hashSkillDirectory(join(b.directory, "parent", "nested"))).toThrow();
    expect(() => readSkillFile(b.directory, "parent/nested/read.cjs")).toThrow();
    expect(readSkillFile(a.directory, "nested/read.cjs", 7).toString()).toBe("bounded");
    expect(() => readSkillFile(a.directory, "nested/read.cjs", 6)).toThrow(/limit/);
    expect(() => readSkillFile(a.directory, "../outside")).toThrow(/ścieżka/);
  });
  it("reports a missing configured trusted runtime without ever starting candidate code", async () => {
    const a = skill("throw Error('MUST_NOT_RUN')");
    const sandbox = createSkillIsolation({ nodeBinary: "/missing/jarvis/node" });
    const result = await sandbox.run(a);
    expect(result).toMatchObject({ ok: false, status: "EXTERNAL_BLOCKER", code: "ISOLATION_UNAVAILABLE", output: "" });
  });
});

// Explicit Linux integration gate: these assertions execute real Node inside bwrap/seccomp.
// Absence of the prerequisite fails this opt-in suite; it never converts a blocker to PASS.
describe.runIf(process.env.JARVIS_TEST_SKILL_SANDBOX === "1")("real skill OS sandbox", () => {
  const sandbox = createSkillIsolation();
  beforeAll(async () => { expect(await sandbox.probe({ force: true })).toMatchObject({ ok: true, available: true, status: "AVAILABLE" }); }, 10000);
  afterEach(() => { sandbox.cancelAll(); });
  it("executes an unknown JSON-to-CSV task with a concrete output assertion", async () => {
    const a = skill("let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const rows=JSON.parse(input);const cols=Object.keys(rows[0]);const esc=v=>'\"'+String(v).replaceAll('\"','\"\"')+'\"';console.log(cols.map(esc).join(',')+'\\n'+rows.map(r=>cols.map(k=>esc(r[k])).join(',')).join('\\n'))})");
    const result = await sandbox.test({ ...a, input: [{ city: "Łódź", value: 7 }, { city: "a,b", value: 3 }], expectedOutput: '"city","value"\n"Łódź","7"\n"a,b","3"' });
    expect(result.ok).toBe(true);
    expect(result.evidence).toMatchObject({ hash: a.hash, hostWritableMounts: [], childProcesses: "denied by seccomp" });
    expect(await sandbox.test({ ...a, input: [{ x: 1 }], expectedOutput: "wrong" })).toMatchObject({ ok: false, status: "FAILED" });
  });
  it("denies host-file secrets, environment secrets, host writes and child processes", async () => {
    const outside = skill("SYNTHETIC-PRIVATE");
    const a = skill(`const fs=require('node:fs'),cp=require('node:child_process');let read=false,write=false,dev=false,addon=null;try{fs.readFileSync(${JSON.stringify(join(outside.directory, "run.cjs"))})}catch{read=true}try{fs.writeFileSync('/skill/run.cjs','replaced')}catch{write=true}try{fs.writeFileSync('/dev/escape-quota','x')}catch{dev=true}try{process.dlopen({exports:{}},'/skill/run.cjs')}catch(e){addon=e.code}const child=cp.spawnSync('/runtime/node',['-e','process.exit(0)']);console.log(JSON.stringify({read,write,dev,addon,env:process.env.JARVIS_SYNTHETIC_SECRET||null,child:child.error?.code}));`);
    const previous = process.env.JARVIS_SYNTHETIC_SECRET; process.env.JARVIS_SYNTHETIC_SECRET = "SYNTHETIC-PRIVATE";
    try {
      const result = await sandbox.run(a);
      expect(result.ok).toBe(true); expect(JSON.parse(result.output)).toEqual({ read: true, write: true, dev: true, addon: "ERR_DLOPEN_DISABLED", env: null, child: "EPERM" });
      expect(readFileSync(join(outside.directory, "run.cjs"), "utf8")).toBe("SYNTHETIC-PRIVATE");
      expect(hashSkillDirectory(a.directory)).toBe(a.hash);
    } finally { if (previous === undefined) delete process.env.JARVIS_SYNTHETIC_SECRET; else process.env.JARVIS_SYNTHETIC_SECRET = previous; }
  });
  it("detects tampering and path traversal before launching", async () => {
    const a = skill("console.log('initial')"); writeFileSync(join(a.directory, "run.cjs"), "console.log('tampered')");
    expect(await sandbox.run(a)).toMatchObject({ ok: false, status: "REJECTED", code: "HASH_MISMATCH", output: "" });
    expect(await sandbox.run({ ...a, entrypoint: "../secret.cjs" })).toMatchObject({ ok: false, code: "ENTRY_INVALID" });
  });
  it("denies external networking in a real network namespace", async () => {
    const a = skill("const net=require('node:net');const s=net.connect({host:'192.0.2.1',port:80});s.on('connect',()=>{console.log('LEAK');process.exit(2)});s.on('error',e=>console.log(e.code));s.setTimeout(250,()=>s.destroy());");
    const result = await sandbox.run(a); expect(result.ok).toBe(true); expect(result.output.trim()).toMatch(/ENETUNREACH|EHOSTUNREACH|EPERM/);
  });
  it("enforces the real CPU limit and the independent wall deadline", async () => {
    const cpu = await sandbox.run({ ...skill("while(true){}"), limits: { cpuSeconds: 1 } });
    expect(cpu.ok).toBe(false); expect(cpu.status).toBe("FAILED"); expect(cpu.evidence.elapsedMs).toBeLessThan(4000);
    const wall = await sandbox.run({ ...skill("setInterval(()=>{},1000)"), limits: { timeoutMs: 150 } });
    expect(wall.status).toBe("TIMEOUT"); expect(wall.evidence.elapsedMs).toBeLessThan(2000);
  }, 10000);
  it("enforces file-size and aggregate scratch filesystem quotas", async () => {
    const file = await sandbox.run({ ...skill("require('node:fs').writeFileSync('/work/huge',Buffer.alloc(20000));console.log('unbounded')"), limits: { fileBytes: 1024 } });
    expect(file.ok).toBe(false); expect(file.output).not.toContain("unbounded");
    const quota = await sandbox.run({ ...skill("const fs=require('node:fs');for(let i=0;i<100;i++)fs.writeFileSync('/work/f'+i,Buffer.alloc(32768));console.log('unbounded')"), limits: { scratchBytes: 1024 * 1024 } });
    expect(quota.ok).toBe(false); expect(quota.stderr).toContain("ENOSPC");
  });
  it("enforces address-space memory and stdout limits", async () => {
    const memory = await sandbox.run(skill("const a=[];for(let i=0;i<1000;i++)a.push(Buffer.alloc(64*1024*1024,1));console.log('unbounded')"));
    expect(memory.ok).toBe(false); expect(memory.output).not.toContain("unbounded"); expect(memory.status).toBe("FAILED");
    const output = await sandbox.run({ ...skill("process.stdout.write('x'.repeat(50000))"), limits: { outputBytes: 1024 } });
    expect(output.status).toBe("OUTPUT_LIMIT"); expect(output.output.length).toBeLessThanOrEqual(1024);
  });
  it("STOP kills only its group and a new task receives a fresh cancellation signal", async () => {
    const controller = new AbortController();
    const promise = sandbox.run({ ...skill("console.log('started');setInterval(()=>{},1000)"), signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 150);
    const result = await promise; clearTimeout(timer);
    expect(result.status).toBe("CANCELLED"); expect(result.evidence.elapsedMs).toBeLessThan(2000);
    expect(await sandbox.run(skill("console.log('fresh')"))).toMatchObject({ ok: true, output: "fresh\n" });
  });
});
