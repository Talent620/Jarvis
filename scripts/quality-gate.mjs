import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const npmScript = process.env.npm_execpath;
const includeSales = process.argv.includes("--sales");

function run(label, command, args, cwd = root, env = process.env) {
  console.log(`\n[QUALITY] ${label}`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} nie przeszedł (kod ${result.status ?? "?"}).`);
}

function runNpm(label, args, cwd = root) {
  if (process.platform === "win32" && npmScript) {
    return run(label, process.execPath, [npmScript, ...args], cwd);
  }
  return run(label, "npm", args, cwd);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Site OS zakończył się kodem ${child.exitCode}.`);
    try {
      const response = await fetch(url + "/api/health", { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Serwer jeszcze startuje.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Site OS nie odpowiedział w ciągu 15 sekund.");
}

async function siteOsSmoke() {
  console.log("\n[QUALITY] Site OS smoke");
  const temp = mkdtempSync(path.join(os.tmpdir(), "jarvis-site-quality-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    SITE_OS_PORT: String(port),
    SITE_OS_DATA_DIR: path.join(temp, "data"),
    SITE_OS_RUNTIME_DIR: path.join(temp, "runtime"),
    SITE_OS_TOOLS_DIR: path.join(temp, "tools"),
  };
  const child = spawn(process.execPath, ["site-os/server.mjs"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-20_000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-20_000); });

  try {
    await waitForHealth(url, child);
    run("Site OS API i bezpieczeństwo", process.execPath, ["site-os/scripts/smoke.mjs"], root, {
      ...process.env,
      SITE_OS_URL: url,
    });
  } catch (error) {
    if (output.trim()) console.error(output.trim());
    throw error;
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  runNpm("Skan sekretów", ["run", "scan:secrets"]);
  runNpm("Lint", ["run", "lint"]);
  runNpm("Pełne testy", ["test"]);
  runNpm("Build produkcyjny", ["run", "build"]);
  await siteOsSmoke();
  if (includeSales) runNpm("AI Sales gates", ["run", "gates"], path.join(root, "sales-os"));
  console.log(`\n[QUALITY] PASS${includeSales ? " — JARVIS + Site OS + AI Sales" : " — JARVIS + Site OS"}`);
} catch (error) {
  console.error(`\n[QUALITY] FAIL — ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
