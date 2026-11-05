import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { readRuntimeConnection } = require("../electron/runtime-connection.cjs");
const original = process.env.JARVIS_RUNTIME_DATA_DIR;
const dirs: string[] = [];
afterEach(() => {
  if (original === undefined) delete process.env.JARVIS_RUNTIME_DATA_DIR; else process.env.JARVIS_RUNTIME_DATA_DIR = original;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(value: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-discovery-")); dirs.push(dir);
  process.env.JARVIS_RUNTIME_DATA_DIR = dir;
  const file = join(dir, "connection.json");
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  return file;
}
describe("private runtime discovery", () => {
  it("reads the private loopback connection for the desktop bridge", () => {
    const value = { url: "http://127.0.0.1:3211", token: "a".repeat(64) };
    fixture(value); expect(readRuntimeConnection()).toEqual(value);
  });
  it("rejects a replaced remote endpoint before exposing its token", () => {
    fixture({ url: "https://example.com", token: "a".repeat(64) }); expect(readRuntimeConnection()).toBeNull();
  });
  it("rejects group-readable discovery files on Linux", () => {
    const file = fixture({ url: "http://127.0.0.1:3211", token: "a".repeat(64) });
    chmodSync(file, 0o644); if (process.platform !== "win32") expect(readRuntimeConnection()).toBeNull();
  });
  it("handles incomplete startup files without breaking the UI", () => {
    fixture({ url: "http://127.0.0.1:3211" }); expect(readRuntimeConnection()).toBeNull();
  });
});
