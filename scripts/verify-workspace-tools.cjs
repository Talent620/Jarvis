const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createWorkspaceTools } = require("../electron/workspace-tools.cjs");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tools-check-"));
  const opened = [];
  const runtime = createWorkspaceTools({ root, openExternal: async (url) => opened.push(url) });
  const checks = [];
  const server = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.end("jarvis-ok"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const check = async (name, tool, input, expected = (result) => result.ok) => {
    const result = await runtime.call(tool, input);
    checks.push({ name, ok: Boolean(expected(result)), detail: result.error || result.stderr || result.status || "ok" });
    return result;
  };

  try {
    const status = await check("status", "status", {});
    await check("files.write", "files_write", { path: "test/hello.txt", content: "JARVIS" });
    await check("files.read", "files_read", { path: "test/hello.txt" }, (r) => r.ok && r.content === "JARVIS");
    await check("files.list", "files_list", { path: "test" }, (r) => r.ok && r.entries.some((e) => e.name === "hello.txt"));
    await check("git", "git", { args: ["init"] });
    await check("terminal", "terminal", { command: "node", args: ["--version"] });
    await check("http", "http", { url: `http://127.0.0.1:${port}/health`, method: "GET" }, (r) => r.ok && r.body === "jarvis-ok");
    await check("browser", "browser_open", { url: "https://example.com" }, (r) => r.ok && opened.length === 1);
    await check("generated tool", "generated_tool", {
      name: "self-check",
      code: "if (process.argv.includes('--self-test')) { console.log('ok'); process.exit(0); }\n",
    }, (r) => r.ok && r.accepted === true);

    if (status.dependencies && status.dependencies.docker) await check("docker", "docker", { args: ["version"] });
    else checks.push({ name: "docker", ok: null, detail: "brak klienta" });
    if (status.dependencies && status.dependencies.sqlite) {
      await check("sqlite", "database", { engine: "sqlite", database: "test/check.db", query: "SELECT 1 AS ok" });
    } else checks.push({ name: "sqlite", ok: null, detail: "brak klienta sqlite3" });
    if (status.dependencies && status.dependencies.postgres) {
      checks.push({ name: "postgres", ok: null, detail: "klient jest; test połączenia wymaga connection string" });
    } else checks.push({ name: "postgres", ok: null, detail: "brak klienta psql" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
  }

  console.table(checks);
  const failed = checks.filter((item) => item.ok === false);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
