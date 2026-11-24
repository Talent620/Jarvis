import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
// @ts-expect-error — moduł .mjs bez deklaracji typów (skrypt Node).
import * as pm from "../scripts/lib/project-memory.mjs";

const REPO = path.resolve(__dirname, "..");
const LIB_URL = pathToFileURL(path.join(REPO, "scripts/lib/project-memory.mjs")).href;
const SCHEMA = fs.readFileSync(path.join(REPO, "project-memory/schema/event.schema.json"), "utf8");
const SOURCES = fs.readFileSync(path.join(REPO, "project-memory/sources.json"), "utf8");
const temps: string[] = [];

// Fałszywe sekrety budowane w runtime (nie są prawdziwymi kluczami).
const FAKE = {
  openrouter: "sk-or-v1-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4",
  github: "ghp_" + "Z".repeat(10) + "y".repeat(12),
  vllm: "jvllm_" + "9xK4mP7qR2vL8nW3",
  modal: "as-" + "Q".repeat(8) + "w".repeat(10),
  google: "AIza" + "S".repeat(33),
};

function sh(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(root: string, rel: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-pm-"));
  temps.push(root);
  write(root, "package.json", JSON.stringify({ name: "fixture", version: "1.2.3", scripts: { test: "vitest run", lint: "eslint ." } }, null, 2));
  write(root, "src/lib/selfManifest.ts", 'export const JARVIS_VERSION = "9.9.9-test";\nexport const JARVIS_MODULES = [\n  "Moduł A",\n  "Moduł B",\n] as const;\n');
  write(root, "src/lib/tools.ts", 'export const T = [\n  {\n    name: "add_task",\n  },\n  {\n    name: "list_notes",\n  },\n];\n');
  write(root, ".github/workflows/test.yml", "name: Tests\n\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\njobs: {}\n");
  write(root, "docs/JARVIS_REPAIR_PLAN.md", "# Plan\n\n### K1. Zrobione\n\nStatus: **wykonane**\n\n### K5. Paczki Linux\n\nStatus: **oczekuje**\n\n### W3. Site OS — wykonane\n\n### W9. Bez statusu\n\nopis\n");
  write(root, "docs/horizon-memory.md", "# H\n\n## 5. Aktywne ryzyka\n\n- **R1:** błąd 500\n- **R2:** cel S9\n\n## 6. Punkt\n\n- nie to\n");
  write(root, "docs/DEVLOG.md", "# D\n\n### Świadomie ODŁOŻONE (x)\n- **BFF fail-closed**\n\n### Proponowane kolejne kierunki rozwoju\n1. Decyzja APP_TOKEN\n\n### Inne\n- nie\n");
  write(root, "project-memory/schema/event.schema.json", SCHEMA);
  write(root, "project-memory/sources.json", SOURCES);
  write(root, ".gitignore", "project-memory/reports/logs/\nproject-memory/.lock\nproject-memory/**/.tmp-*\n");
  sh(root, ["init", "-q", "-b", "main"]);
  sh(root, ["config", "user.email", "t@example.com"]);
  sh(root, ["config", "user.name", "Test"]);
  sh(root, ["config", "commit.gpgsign", "false"]);
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "-q", "-m", "init"]);
  return root;
}

const ok = { command: process.execPath, args: ["-e", "console.log('Test Files  3 passed (3)'); console.log('      Tests  12 passed (12)')"] };
const bad = { command: process.execPath, args: ["-e", "console.error('boom'); process.exit(3)"] };

function validEvent(over: Record<string, unknown> = {}) {
  return {
    taskId: "guardian-5a",
    agent: "antigravity",
    startCommit: "abcdef1",
    endCommit: "abcdef2",
    summary: "Zbudowano pamięć projektu",
    changedFiles: ["AGENTS.md"],
    commands: [{ command: "npm test", exitCode: 0 }],
    testResults: [],
    problems: [],
    nextStep: "Sprint 5b",
    ...over,
  };
}

function hashTree(root: string, skip: (rel: string) => boolean) {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (rel === ".git" || skip(rel)) continue;
      if (e.isDirectory()) walk(full);
      else out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}

afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true });
});

describe("generator stanu", () => {
  it("zbiera rzeczywisty commit, branch, manifest, workflowy i otwarte sprawy z istniejących dokumentów", () => {
    const root = fixture();
    const s = pm.collectState(root);
    expect(s.git.commit).toBe(sh(root, ["rev-parse", "HEAD"]));
    expect(s.git.branch).toBe("main");
    expect(s.git.dirty).toBe(false);
    expect(s.repository.status).toBe("LOCAL_ONLY");
    expect(s.project).toEqual({ name: "fixture", version: "1.2.3" });
    expect(s.manifest.version).toBe("9.9.9-test");
    expect(s.manifest.modules).toEqual(["Moduł A", "Moduł B"]);
    expect(s.manifest.tools).toEqual(["add_task", "list_notes"]);
    expect(s.workflows).toEqual([{ file: ".github/workflows/test.yml", name: "Tests", triggers: ["push", "workflow_dispatch"] }]);
    expect(s.scripts).toEqual(["test", "lint"]);
    const texts = s.openItems.map((i: any) => i.text);
    expect(texts).toContain("K5. Paczki Linux");
    expect(texts).toContain("W9. Bez statusu");
    expect(texts).not.toContain("K1. Zrobione");
    expect(texts.some((t: string) => t.includes("W3"))).toBe(false);
    expect(texts).toContain("R1: błąd 500");
    expect(texts).toContain("BFF fail-closed");
    expect(texts).toContain("Decyzja APP_TOKEN");
    expect(texts).not.toContain("nie to");
    expect(s.openItems.every((i: any) => /:\d+$/.test(i.source))).toBe(true);
    expect(s.knowledgeGaps.expectedButMissing).toEqual(["docs/JARVIS_CONTROL_CENTER.md", "JARVIS_BACKLOG.md", "JARVIS_NEXT.md"]);
  });

  it("bez raportów wszystkie checki i APK są UNKNOWN — nigdy PASS", () => {
    const root = fixture();
    const s = pm.collectState(root);
    for (const c of Object.values(s.checks) as any[]) expect(c.status).toBe("UNKNOWN");
    expect(s.apk.status).toBe("UNKNOWN");
    expect(s.nextRecommendedStep).toBe("UNKNOWN");
  });

  it("PASS/FAIL pochodzą z rzeczywistego uruchomienia z zapisem daty, commita, polecenia, kodu wyjścia i logu", () => {
    const root = fixture();
    const r1 = pm.runCheck(root, "test", ok);
    expect(r1.exitCode).toBe(0);
    expect(r1.commit).toBe(sh(root, ["rev-parse", "HEAD"]));
    expect(r1.command).toContain(process.execPath);
    expect(Date.parse(r1.startedAt)).not.toBeNaN();
    expect(fs.existsSync(path.join(root, r1.logPath))).toBe(true);
    expect(r1.summary.tests).toContain("12 passed");
    const r2 = pm.runCheck(root, "lint", bad);
    expect(r2.exitCode).toBe(3);
    const s = pm.collectState(root);
    expect(s.checks.test.status).toBe("PASS");
    expect(s.checks.lint.status).toBe("FAIL");
    expect(s.checks.lint.reason).toContain("3");
    expect(s.checks.build.status).toBe("UNKNOWN");
  });

  it("niedostępny skrypt npm daje UNKNOWN, nie sukces", () => {
    const root = fixture();
    const r = pm.runCheck(root, "build", { npmScript: "build", command: "npm", args: ["run", "build"] });
    expect(r.available).toBe(false);
    expect(r.exitCode).toBeNull();
    expect(pm.collectState(root).checks.build.status).toBe("UNKNOWN");
  });

  it("CURRENT_STATE.md ma maksymalnie ~100 linii nawet przy dużej liczbie danych", () => {
    const root = fixture();
    const many = Array.from({ length: 80 }, (_, i) => `### X${i}. Sprawa ${i}\n\nStatus: oczekuje\n`).join("\n");
    write(root, "docs/JARVIS_REPAIR_PLAN.md", "# P\n\n" + many);
    for (let i = 0; i < 15; i++) pm.writeEvent(root, validEvent({ taskId: `t-${i}` }));
    const state = pm.syncState(root);
    const md = fs.readFileSync(path.join(root, "project-memory/CURRENT_STATE.md"), "utf8");
    expect(md.split("\n").length).toBeLessThanOrEqual(pm.MD_MAX_LINES + 2);
    expect(state.openItems.length).toBeGreaterThanOrEqual(80);
  });
});

describe("wykrywanie nieaktualnych raportów", () => {
  it("nowy commit po teście → STALE", () => {
    const root = fixture();
    pm.runCheck(root, "test", ok);
    write(root, "src/new.ts", "export const x = 1;\n");
    sh(root, ["add", "-A"]);
    sh(root, ["commit", "-q", "-m", "next"]);
    const c = pm.collectState(root).checks.test;
    expect(c.status).toBe("STALE");
    expect(c.reason).toContain("HEAD");
  });

  it("commit zawierający wyłącznie project-memory/ nie unieważnia raportu (i jest to jawnie opisane)", () => {
    const root = fixture();
    pm.runCheck(root, "test", ok);
    pm.writeEvent(root, validEvent());
    pm.syncState(root);
    sh(root, ["add", "-A"]);
    sh(root, ["commit", "-q", "-m", "memory only"]);
    const c = pm.collectState(root).checks.test;
    expect(c.status).toBe("PASS");
    expect(c.reason).toContain("kod identyczny");
  });

  it("niezatwierdzona zmiana kodu po teście → STALE; zmiany w project-memory nie unieważniają", () => {
    const root = fixture();
    pm.runCheck(root, "test", ok);
    pm.writeEvent(root, validEvent());
    pm.syncState(root);
    expect(pm.collectState(root).checks.test.status).toBe("PASS");
    fs.appendFileSync(path.join(root, "src/lib/tools.ts"), "// zmiana\n");
    expect(pm.collectState(root).checks.test.status).toBe("STALE");
  });

  it("raport starszy niż 7 dni, z przyszłości lub bez kodu wyjścia nie daje PASS", () => {
    const root = fixture();
    const r = pm.runCheck(root, "test", ok);
    const ctx = { commit: r.commit, fingerprint: pm.worktreeFingerprint(root) };
    expect(pm.evaluateReport(r, { ...ctx, now: new Date(Date.parse(r.finishedAt) + 8 * 86400000) }).status).toBe("STALE");
    expect(pm.evaluateReport(r, { ...ctx, now: new Date(Date.parse(r.finishedAt) - 60000) }).status).toBe("STALE");
    expect(pm.evaluateReport({ ...r, exitCode: undefined }, ctx).status).toBe("UNKNOWN");
    expect(pm.evaluateReport(null, ctx).status).toBe("UNKNOWN");
    expect(pm.evaluateReport({ ...r, timedOut: true, exitCode: null }, ctx).status).toBe("FAIL");
  });

  it("APK: brak danych → UNKNOWN; zielony build innego commita → STALE; HEAD + asset → PASS", () => {
    const now = new Date();
    const base = { releaseTag: "v4", checkedAt: now.toISOString(), apkAssets: [{ name: "a.apk" }], lastRun: { databaseId: 1, headSha: "a".repeat(40), conclusion: "success", status: "completed" } };
    expect(pm.evaluateApk(null, { commit: "x", now }).status).toBe("UNKNOWN");
    expect(pm.evaluateApk({ ...base, lastRun: null }, { commit: "x", now }).status).toBe("UNKNOWN");
    expect(pm.evaluateApk(base, { commit: "b".repeat(40), now }).status).toBe("STALE");
    expect(pm.evaluateApk({ ...base, apkAssets: [] }, { commit: "a".repeat(40), now }).status).toBe("UNKNOWN");
    expect(pm.evaluateApk({ ...base, lastRun: { ...base.lastRun, conclusion: "failure" } }, { commit: "a".repeat(40), now }).status).toBe("FAIL");
    expect(pm.evaluateApk(base, { commit: "a".repeat(40), now }).status).toBe("PASS");
  });
});

describe("schemat zdarzeń", () => {
  const schema = JSON.parse(SCHEMA);
  const full = (over = {}) => ({ schemaVersion: 1, timestamp: new Date().toISOString(), redactions: 0, ...validEvent(over) });

  it("plik schematu jest poprawnym JSON Schema 2020-12", () => {
    expect(schema.$schema).toContain("2020-12");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["taskId", "agent", "startCommit", "endCommit", "changedFiles", "commands", "testResults", "problems", "nextStep"]));
  });

  it("akceptuje poprawne zdarzenie", () => {
    expect(pm.validateEvent(full(), schema)).toEqual([]);
  });

  it("odrzuca brak pól, nadmiarowe pola, zły typ, nieznanego agenta i złą datę", () => {
    const e: any = full();
    delete e.nextStep;
    expect(pm.validateEvent(e, schema).join()).toContain("nextStep");
    expect(pm.validateEvent({ ...full(), conversation: "x" }, schema).join()).toContain("conversation");
    expect(pm.validateEvent(full({ changedFiles: "AGENTS.md" }), schema).length).toBeGreaterThan(0);
    expect(pm.validateEvent(full({ agent: "gpt" }), schema).length).toBeGreaterThan(0);
    expect(pm.validateEvent({ ...full(), timestamp: "wczoraj" }, schema).length).toBeGreaterThan(0);
    expect(pm.validateEvent(full({ taskId: "../etc/passwd" }), schema).length).toBeGreaterThan(0);
  });

  it("odrzuca PASS z deklaracji agenta (bez raportu, kodu 0 i skrótu)", () => {
    const claim = full({ testResults: [{ check: "test", status: "PASS", source: "agent-claim" }] });
    expect(pm.validateEvent(claim, schema).join()).toContain("PASS bez dowodu");
    const proven = full({ testResults: [{ check: "test", status: "PASS", source: "report", exitCode: 0, reportCommit: "abc1234", reportDigest: "f".repeat(64) }] });
    expect(pm.validateEvent(proven, schema)).toEqual([]);
  });

  it("writeEvent odrzuca niepoprawne zdarzenie i niczego nie zapisuje", () => {
    const root = fixture();
    expect(() => pm.writeEvent(root, validEvent({ agent: "nieznany" }))).toThrow(/schematem/);
    const dir = path.join(root, "project-memory/events");
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });

  it("readEvents oznacza uszkodzone i niezgodne pliki jako niepoprawne (stan je raportuje)", () => {
    const root = fixture();
    pm.writeEvent(root, validEvent());
    write(root, "project-memory/events/20260101T000000000Z-x-broken.json", "{ nie json");
    write(root, "project-memory/events/20260101T000000001Z-x-bad.json", JSON.stringify({ taskId: "x" }));
    const s = pm.collectState(root);
    expect(s.events.total).toBe(3);
    expect(s.events.valid).toBe(1);
    expect(s.events.invalid).toHaveLength(2);
  });
});

describe("równoległe zdarzenia", () => {
  it("ta sama milisekunda w jednym procesie → osobne pliki z sufiksem, bez nadpisania", () => {
    const root = fixture();
    const now = () => new Date("2026-11-24T12:00:00.000Z");
    const files = Array.from({ length: 5 }, () => pm.writeEvent(root, validEvent(), { now }).file);
    expect(new Set(files).size).toBe(5);
    expect(path.basename(files[0])).toBe("20261124T120000000Z-antigravity-guardian-5a.json");
    expect(path.basename(files[1])).toBe("20261124T120000000Z-antigravity-guardian-5a-2.json");
  });

  it("20 równoległych procesów (3 agentów, to samo zadanie) zapisuje 20 poprawnych, kompletnych plików", async () => {
    const root = fixture();
    const agents = ["antigravity", "codex", "claude"];
    const script = `
      const pm = await import(${JSON.stringify(LIB_URL)});
      const [root, agent, i] = process.argv.slice(1);
      pm.writeEvent(root, { taskId: "shared-task", agent, startCommit: "abcdef1", endCommit: "abcdef2",
        summary: "równoległe " + i, changedFiles: [], commands: [], testResults: [], problems: [], nextStep: "dalej" },
        { now: () => new Date("2026-11-24T12:00:00.000Z") });`;
    const codes = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        new Promise<number>((resolve) => {
          const p = spawn(process.execPath, ["--input-type=module", "-e", script, root, agents[i % 3], String(i)], { stdio: "ignore" });
          p.on("exit", (code) => resolve(code ?? -1));
        }),
      ),
    );
    expect(codes.every((c) => c === 0)).toBe(true);
    const events = pm.readEvents(root);
    expect(events).toHaveLength(20);
    expect(events.every((e: any) => e.valid)).toBe(true);
    expect(new Set(events.map((e: any) => e.event.summary)).size).toBe(20);
    expect(fs.readdirSync(path.join(root, "project-memory/events")).some((f) => f.startsWith(".tmp-"))).toBe(false);
  }, 30000);

  it("blokada stanu: zajęta → błąd; przeterminowana → przejęta", () => {
    const root = fixture();
    const lock = path.join(root, "project-memory/.lock");
    fs.writeFileSync(lock, JSON.stringify({ pid: 1, at: Date.now() }));
    expect(() => pm.syncState(root)).toThrow(/zablokowane/);
    fs.writeFileSync(lock, JSON.stringify({ pid: 1, at: Date.now() - pm.LOCK_STALE_MS - 1000 }));
    expect(pm.syncState(root).git.branch).toBe("main");
    expect(fs.existsSync(lock)).toBe(false);
  });
});

describe("odtwarzanie stanu po restarcie", () => {
  it("usunięcie plików generowanych + śmieci po przerwanym zapisie → identyczny stan z raportów i zdarzeń", () => {
    const root = fixture();
    pm.runCheck(root, "test", ok);
    pm.writeEvent(root, validEvent({ nextStep: "Krok po restarcie" }));
    const before = pm.syncState(root);
    fs.rmSync(path.join(root, "project-memory/CURRENT_STATE.json"));
    fs.rmSync(path.join(root, "project-memory/CURRENT_STATE.md"));
    write(root, "project-memory/events/.tmp-999-deadbeef", '{"przerwany":');
    write(root, "project-memory/.tmp-999-cafe", "połowa");
    const after = pm.syncState(root, { now: new Date(Date.now() + 1000) });
    expect(pm.stableView(after)).toEqual(pm.stableView(before));
    expect(after.checks.test.status).toBe("PASS");
    expect(after.nextRecommendedStep.text).toBe("Krok po restarcie");
    expect(pm.verifyGenerated(root)).toEqual([]);
  });

  it("ręczna edycja plików generowanych jest wykrywana", () => {
    const root = fixture();
    pm.syncState(root);
    const md = path.join(root, "project-memory/CURRENT_STATE.md");
    fs.writeFileSync(md, fs.readFileSync(md, "utf8").replace("UNKNOWN", "PASS"));
    expect(pm.verifyGenerated(root).join()).toContain("CURRENT_STATE.md");
    pm.syncState(root);
    const js = path.join(root, "project-memory/CURRENT_STATE.json");
    const data = JSON.parse(fs.readFileSync(js, "utf8"));
    data.checks.test.status = "PASS";
    fs.writeFileSync(js, JSON.stringify(data));
    expect(pm.verifyGenerated(root).join()).toContain("CURRENT_STATE.json");
  });
});

describe("redakcja sekretów", () => {
  it("redaguje znane formaty i przypisania, zachowując placeholdery", () => {
    const input = `or=${FAKE.openrouter} gh ${FAKE.github} key ${FAKE.vllm} modal ${FAKE.modal} g ${FAKE.google} ANDROID_KEYSTORE_PASSWORD=SuperTajne123 https://user:pa55word@example.com Bearer ${"t".repeat(32)}`;
    const { text, count } = pm.redactString(input);
    for (const v of Object.values(FAKE)) expect(text).not.toContain(v);
    expect(text).not.toContain("SuperTajne123");
    expect(text).not.toContain("pa55word");
    expect(text).toContain("ANDROID_KEYSTORE_PASSWORD=[REDACTED:assignment]");
    expect(count).toBeGreaterThanOrEqual(8);
    expect(pm.redactString("ustaw sk-or-v1-abc w ustawieniach; ${{ secrets.VLLM_API_KEY }}").count).toBe(0);
  });

  it("zdarzenie z sekretem zapisuje się zredagowane z licznikiem redakcji", () => {
    const root = fixture();
    const { file } = pm.writeEvent(root, validEvent({ summary: `Ustawiono klucz ${FAKE.vllm}`, problems: [`token ${FAKE.github}`] }));
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain(FAKE.vllm);
    expect(raw).not.toContain(FAKE.github);
    expect(JSON.parse(raw).redactions).toBe(2);
  });

  it("wyjście polecenia z sekretem jest redagowane w raporcie i w logu", () => {
    const root = fixture();
    const r = pm.runCheck(root, "test", { command: process.execPath, args: ["-e", `console.log(${JSON.stringify("leak " + FAKE.openrouter)})`] });
    expect(JSON.stringify(r)).not.toContain(FAKE.openrouter);
    expect(fs.readFileSync(path.join(root, r.logPath), "utf8")).not.toContain(FAKE.openrouter);
    expect(fs.readFileSync(path.join(root, "project-memory/reports/test.json"), "utf8")).not.toContain(FAKE.openrouter);
  });

  it("adres zdalny z poświadczeniami jest redagowany w stanie", () => {
    const root = fixture();
    sh(root, ["remote", "add", "origin", "https://x-access-token:supersecretvalue123@github.com/o/r.git"]);
    const s = pm.collectState(root);
    expect(JSON.stringify(s)).not.toContain("supersecretvalue123");
    expect(s.repository.remotes[0]).toMatchObject({ host: "github.com", protocol: "https" });
  });
});

describe("zachowanie istniejących dokumentów", () => {
  it("sync, runCheck i writeEvent zapisują wyłącznie w project-memory/", () => {
    const root = fixture();
    const outside = (rel: string) => rel.startsWith("project-memory");
    const before = hashTree(root, outside);
    pm.runCheck(root, "test", ok);
    pm.writeEvent(root, validEvent());
    pm.syncState(root);
    expect(hashTree(root, outside)).toEqual(before);
  });

  it("w prawdziwym repo: źródła wiedzy istnieją, protokół jest wspólny i mieści się w limitach narzędzi", () => {
    const sources = JSON.parse(SOURCES);
    for (const s of sources.openItemSources) expect(fs.existsSync(path.join(REPO, s.file))).toBe(true);
    const agents = fs.readFileSync(path.join(REPO, "AGENTS.md"));
    expect(agents.length).toBeLessThan(20_000);
    expect(fs.readFileSync(path.join(REPO, "CLAUDE.md"), "utf8")).toMatch(/^@AGENTS\.md/m);
    for (const doc of ["README.md", "CHANGELOG.md", "SECURITY.md", "docs/DEVLOG.md", "docs/PROGRESS.md", "docs/horizon-memory.md", "docs/JARVIS_REPAIR_PLAN.md"]) {
      expect(fs.existsSync(path.join(REPO, doc))).toBe(true);
    }
  });

  it("w prawdziwym repo: collectState działa tylko do odczytu i znajduje otwarte sprawy z dokumentacji", () => {
    const s = pm.collectState(REPO);
    expect(s.git.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(s.manifest.modules.length).toBeGreaterThan(0);
    expect(s.manifest.tools.length).toBeGreaterThan(50);
    expect(s.openItems.length).toBeGreaterThan(0);
  });
});
