import { createRequire } from "node:module";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { createWorkspaceTools } = require("../electron/workspace-tools.cjs");
it("STOP kończy rzeczywisty proces zadania i nie zgłasza jego sukcesu", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "jarvis-stop-process-"));
  const runtime = createWorkspaceTools({ root });
  const marker = path.join(root, "ready.pid");
  const code = `require('fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(()=>{},1000)`;
  try {
    const pending = runtime.call("terminal", { command: "node", args: ["-e", code] });
    const deadline = Date.now() + 5000;
    while (!existsSync(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    expect(existsSync(marker)).toBe(true);
    const pid = Number(readFileSync(marker, "utf8"));
    expect(runtime.cancelAll()).toMatchObject({ requested: 1 });
    expect(await pending).toMatchObject({ ok: false, cancelled: true });
    expect(() => process.kill(pid, 0)).toThrow();
    expect(runtime.cancelAll()).toMatchObject({ requested: 0 });
  } finally { runtime.cancelAll(); rmSync(root, { recursive: true, force: true }); }
});
