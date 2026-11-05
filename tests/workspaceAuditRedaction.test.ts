import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createWorkspaceTools } = require("../electron/workspace-tools.cjs");
const directories: string[] = [];

afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("workspace audit log", () => {
  it("redacts nested credentials, URL credentials, query strings and terminal arguments", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-audit-")); directories.push(root);
    const workspace = createWorkspaceTools({ root });
    await workspace.call("terminal", {
      command: "unsupported",
      args: ["--password", "secret-argument", "--api-key=secret-inline", "-e", "secret-script"],
      nested: [{ apiKey: "secret-nested", settings: { password: "secret-password" } }],
      url: "https://secret-user:secret-pass@example.test/path?session=secret-query#secret-fragment",
      note: "Bearer secret-bearer",
    });
    const raw = readFileSync(join(root, ".jarvis/logs/actions.jsonl"), "utf8");
    for (const secret of ["secret-argument", "secret-inline", "secret-script", "secret-nested", "secret-password", "secret-user", "secret-pass", "secret-query", "secret-fragment", "secret-bearer"]) expect(raw).not.toContain(secret);
    const record = JSON.parse(raw);
    expect(record.tool).toBe("terminal");
    expect(record.input.command).toBe("unsupported");
    expect(record.input.args).toBe("[REDACTED]");
    expect(record.input.url).toContain("example.test/path");
    expect(record.ok).toBe(false);
  });

  it("does not alter file writes or their result while withholding file content from the log", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-audit-")); directories.push(root);
    const workspace = createWorkspaceTools({ root });
    const content = "normal text and a secret with no recognizable label";
    const result = await workspace.call("files_write", { path: "notes.txt", content });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toBe(content);
    const record = JSON.parse(readFileSync(join(root, ".jarvis/logs/actions.jsonl"), "utf8"));
    expect(record.input).toEqual({ path: "notes.txt", content: "[REDACTED]" });
    expect(record.ok).toBe(true);
  });
});
