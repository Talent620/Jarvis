const fs = require("fs");
const path = require("path");
const { inside } = require("./workspace-tools.cjs");

const ALLOWED_COMMANDS = new Set(["node", "npx", "python", "python3", "uvx", "docker", "bun", "deno"]);
const CONNECT_TIMEOUT = 20_000;
const CALL_TIMEOUT = 120_000;

function commandName(command) {
  return path.basename(String(command || "")).toLowerCase().replace(/\.(exe|cmd|bat)$/i, "");
}

function cleanConfig(root, raw = {}) {
  const name = String(raw.name || "").trim().slice(0, 60);
  const command = String(raw.command || "").trim();
  if (!/^[a-z0-9 _.-]+$/i.test(name)) throw new Error("Nazwa serwera MCP jest nieprawidłowa.");
  if (!ALLOWED_COMMANDS.has(commandName(command))) {
    throw new Error(`Program „${commandName(command) || command}” nie znajduje się na allowliście MCP.`);
  }
  const args = Array.isArray(raw.args) ? raw.args.map(String).slice(0, 80) : [];
  if (args.some((arg) => arg.length > 4096 || /[\r\n\0]/.test(arg))) {
    throw new Error("Argument MCP jest zbyt długi lub nieprawidłowy.");
  }
  const env = {};
  if (raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)) {
    for (const [key, value] of Object.entries(raw.env).slice(0, 50)) {
      if (/^[A-Z_][A-Z0-9_]*$/i.test(key) && String(value).length <= 10_000) env[key] = String(value);
    }
  }
  return {
    name,
    command,
    args,
    cwd: inside(root, raw.cwd || "."),
    env,
  };
}

function withTimeout(promise, timeout, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createStdioMcpManager(options) {
  const root = path.resolve(options.root);
  const clients = new Map();
  const logDir = path.join(root, ".jarvis", "logs");
  fs.mkdirSync(logDir, { recursive: true });

  const audit = (action, server, ok, detail = "") => {
    const record = {
      at: new Date().toISOString(),
      transport: "stdio",
      action,
      server,
      ok,
      detail: String(detail || "").slice(0, 500),
    };
    fs.appendFileSync(path.join(logDir, "mcp.jsonl"), JSON.stringify(record) + "\n");
  };

  async function close(name) {
    const active = clients.get(name);
    if (!active) return { ok: true };
    clients.delete(name);
    try {
      await active.client.close();
      audit("disconnect", name, true);
      return { ok: true };
    } catch (error) {
      audit("disconnect", name, false, error?.message);
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function connect(rawConfig) {
    let config;
    try {
      config = cleanConfig(root, rawConfig);
      await close(config.name);
      const [{ Client }, { StdioClientTransport, getDefaultEnvironment }] = await Promise.all([
        import("@modelcontextprotocol/sdk/client/index.js"),
        import("@modelcontextprotocol/sdk/client/stdio.js"),
      ]);
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env: { ...getDefaultEnvironment(), ...config.env },
        stderr: "pipe",
      });
      const client = new Client({ name: "JARVIS", version: "2.0.0" }, { capabilities: {} });
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT, "Serwer MCP nie odpowiedział podczas łączenia.");
      const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT, "Serwer MCP nie zwrócił listy narzędzi.");
      clients.set(config.name, { client, transport });
      const tools = Array.isArray(listed?.tools) ? listed.tools.map((tool) => ({
        name: String(tool.name || ""),
        description: String(tool.description || tool.name || ""),
        inputSchema: tool.inputSchema && typeof tool.inputSchema === "object"
          ? tool.inputSchema
          : { type: "object", properties: {} },
      })) : [];
      audit("connect", config.name, true, `${tools.length} tools`);
      return { ok: true, tools };
    } catch (error) {
      if (config?.name) await close(config.name);
      audit("connect", config?.name || String(rawConfig?.name || ""), false, error?.message);
      return { ok: false, error: error?.message || String(error), tools: [] };
    }
  }

  async function call(server, tool, args) {
    const active = clients.get(String(server || ""));
    if (!active) return { ok: false, error: "Serwer MCP nie jest połączony." };
    try {
      const result = await withTimeout(
        active.client.callTool({ name: String(tool || ""), arguments: args && typeof args === "object" ? args : {} }),
        CALL_TIMEOUT,
        "Narzędzie MCP przekroczyło limit czasu.",
      );
      audit("call", server, true, tool);
      return { ok: true, result };
    } catch (error) {
      audit("call", server, false, `${tool}: ${error?.message || error}`);
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function closeAll() {
    await Promise.all([...clients.keys()].map(close));
  }

  return { connect, call, close, closeAll };
}

module.exports = { ALLOWED_COMMANDS, cleanConfig, createStdioMcpManager };
