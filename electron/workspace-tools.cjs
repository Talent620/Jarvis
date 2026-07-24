const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const MAX_OUTPUT = 200_000;
const SAFE_COMMANDS = new Set(["git", "node", "npm", "npx", "docker", "sqlite3", "psql"]);
const BLOCKED_ARGS = /(?:^|\s)(?:--?force|-f|reset\s+--hard|clean\s+-[a-z]*f|rm\b|rmdir\b|del\b|format\b|shutdown\b)/i;

function inside(root, requested = ".") {
  const base = path.resolve(root);
  const target = path.resolve(base, String(requested || "."));
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error("Ścieżka wychodzi poza katalog roboczy.");
  return target;
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    const append = (key, chunk) => {
      const text = chunk.toString();
      if (key === "stdout") stdout = (stdout + text).slice(-MAX_OUTPUT);
      else stderr = (stderr + text).slice(-MAX_OUTPUT);
    };
    child.stdout.on("data", (c) => append("stdout", c));
    child.stderr.on("data", (c) => append("stderr", c));
    const timer = setTimeout(() => child.kill(), options.timeout || 30_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code ?? -1, stdout, stderr });
    });
  });
}

function safeArgs(input) {
  const args = Array.isArray(input) ? input.map(String) : [];
  if (BLOCKED_ARGS.test(args.join(" "))) throw new Error("Ta operacja jest zablokowana przez politykę bezpieczeństwa.");
  return args.slice(0, 40);
}

function createWorkspaceTools(options) {
  const root = path.resolve(options.root);
  const logDir = path.join(root, ".jarvis", "logs");
  const backupDir = path.join(root, ".jarvis", "backups");
  const generatedDir = path.join(root, "tools", "generated");
  for (const dir of [root, logDir, backupDir, generatedDir]) fs.mkdirSync(dir, { recursive: true });

  const audit = (tool, input, result) => {
    const record = { at: new Date().toISOString(), tool, input, ok: result.ok !== false };
    fs.appendFileSync(path.join(logDir, "actions.jsonl"), JSON.stringify(record) + "\n");
  };

  const available = (command) => {
    const probe = spawnSync(command, ["--version"], { shell: false, windowsHide: true, timeout: 10_000 });
    return !probe.error;
  };

  async function call(tool, rawInput = {}) {
    const input = rawInput && typeof rawInput === "object" ? rawInput : {};
    let result;
    try {
      if (tool === "files_list") {
        const target = inside(root, input.path);
        const entries = fs.readdirSync(target, { withFileTypes: true }).slice(0, 500)
          .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
        result = { ok: true, root, path: path.relative(root, target) || ".", entries };
      } else if (tool === "files_read") {
        const target = inside(root, input.path);
        const stat = fs.statSync(target);
        if (stat.size > 2_000_000) throw new Error("Plik jest większy niż bezpieczny limit 2 MB.");
        result = { ok: true, path: path.relative(root, target), content: fs.readFileSync(target, "utf8") };
      } else if (tool === "files_write") {
        const target = inside(root, input.path);
        const content = String(input.content || "");
        if (Buffer.byteLength(content) > 2_000_000) throw new Error("Zapis przekracza limit 2 MB.");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          fs.copyFileSync(target, path.join(backupDir, `${stamp}-${path.basename(target)}`));
        }
        fs.writeFileSync(target, content, "utf8");
        result = { ok: true, path: path.relative(root, target), bytes: Buffer.byteLength(content) };
      } else if (tool === "git") {
        result = await run("git", safeArgs(input.args), { cwd: inside(root, input.cwd), timeout: 60_000 });
      } else if (tool === "terminal") {
        const command = String(input.command || "").toLowerCase();
        if (!SAFE_COMMANDS.has(command)) throw new Error(`Polecenie „${command}” nie znajduje się na allowliście.`);
        result = await run(command, safeArgs(input.args), { cwd: inside(root, input.cwd), timeout: 120_000 });
      } else if (tool === "docker") {
        result = await run("docker", safeArgs(input.args || ["version"]), { cwd: inside(root, input.cwd), timeout: 60_000 });
      } else if (tool === "database") {
        const engine = String(input.engine || "sqlite").toLowerCase();
        const query = String(input.query || "").trim();
        if (!/^(select|pragma|explain|with)\b/i.test(query)) throw new Error("Adapter bazy domyślnie zezwala tylko na bezpieczne zapytania odczytowe.");
        if (engine === "sqlite") {
          result = await run("sqlite3", ["-json", inside(root, input.database), query], { cwd: root, timeout: 30_000 });
        } else if (engine === "postgres") {
          result = await run("psql", [String(input.connection || ""), "-X", "-A", "-t", "-c", query], { cwd: root, timeout: 30_000 });
        } else throw new Error("Obsługiwane bazy: sqlite i postgres.");
      } else if (tool === "http") {
        const url = new URL(String(input.url || ""));
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Dozwolone są tylko adresy HTTP/HTTPS.");
        const response = await fetch(url, {
          method: String(input.method || "GET").toUpperCase(),
          headers: input.headers && typeof input.headers === "object" ? input.headers : {},
          body: input.body == null ? undefined : String(input.body),
          signal: AbortSignal.timeout(20_000),
        });
        result = { ok: response.ok, status: response.status, body: (await response.text()).slice(0, MAX_OUTPUT) };
      } else if (tool === "browser_open") {
        const url = new URL(String(input.url || ""));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Przeglądarka otwiera tylko bezpieczne adresy HTTP/HTTPS.");
        if (typeof options.openExternal !== "function") throw new Error("Otwieranie przeglądarki jest niedostępne w tym środowisku.");
        await options.openExternal(url.toString());
        result = { ok: true, url: url.toString() };
      } else if (tool === "generated_tool") {
        const name = String(input.name || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 60);
        if (!name) throw new Error("Brak poprawnej nazwy narzędzia.");
        const candidate = path.join(generatedDir, `${name}.candidate.cjs`);
        const accepted = path.join(generatedDir, `${name}.cjs`);
        fs.writeFileSync(candidate, String(input.code || ""), "utf8");
        const checked = await run(process.execPath, ["--check", candidate], { cwd: root, timeout: 10_000 });
        if (!checked.ok) {
          fs.unlinkSync(candidate);
          result = { ...checked, accepted: false };
        } else {
          const tested = await run(process.execPath, [candidate, "--self-test"], {
            cwd: root,
            timeout: 15_000,
            env: { JARVIS_TOOL_SELF_TEST: "1" },
          });
          if (!tested.ok) {
            fs.unlinkSync(candidate);
            result = { ...tested, accepted: false };
          } else {
            fs.renameSync(candidate, accepted);
            result = { ok: true, accepted: true, path: path.relative(root, accepted), stdout: tested.stdout };
          }
        }
      } else if (tool === "status") {
        result = {
          ok: true,
          root,
          capabilities: ["files", "git", "terminal", "sqlite", "postgres", "browser", "docker", "http", "generated-tools"],
          dependencies: {
            git: available("git"), node: available(process.execPath), docker: available("docker"),
            sqlite: available("sqlite3"), postgres: available("psql"), browser: typeof options.openExternal === "function",
          },
          safety: { workspaceBoundary: true, commandAllowlist: [...SAFE_COMMANDS], backups: true, auditLog: true },
        };
      } else throw new Error(`Nieznane narzędzie systemowe: ${tool}`);
    } catch (error) {
      result = { ok: false, error: error && error.message ? error.message : String(error) };
    }
    audit(tool, input, result);
    return result;
  }

  return { call, root };
}

module.exports = { createWorkspaceTools, inside, safeArgs, SAFE_COMMANDS };
