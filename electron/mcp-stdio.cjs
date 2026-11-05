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

function withTimeout(promise, timeout, message, signal) {
  let timer; let abort;
  if (signal?.aborted) return Promise.reject(new Error("Operacja MCP anulowana."));
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    }),
    new Promise((_, reject) => { abort = () => reject(new Error("Operacja MCP anulowana; rozpoczęty skutek wymaga sprawdzenia.")); signal?.addEventListener("abort", abort, { once: true }); }),
  ]).finally(() => { clearTimeout(timer); signal?.removeEventListener("abort", abort); });
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

  const tickets = new Map();
  const connectTimeout = Math.min(options.connectTimeout || CONNECT_TIMEOUT, CONNECT_TIMEOUT);
  const callTimeout = Math.min(options.callTimeout || CALL_TIMEOUT, CALL_TIMEOUT);
  async function dispose(active) {
    if (!active) return;
    active.controller.abort();
    // SDK transport closes only its own child, escalating SIGTERM to SIGKILL if needed.
    await Promise.allSettled([active.client.close(), active.transport.close()]);
  }
  async function close(name) {
    name = String(name || "");
    tickets.delete(name); // Fences even an in-progress import/connect, before registration.
    const active = clients.get(name); clients.delete(name);
    await dispose(active);
    audit("disconnect", name, true);
    return { ok: true };
  }

  async function connect(rawConfig) {
    let config; let active; let ticket;
    try {
      config = cleanConfig(root, rawConfig);
      ticket = Symbol(config.name);
      const previous = clients.get(config.name); clients.delete(config.name);
      tickets.set(config.name, ticket);
      await dispose(previous);
      const [{ Client }, { StdioClientTransport, getDefaultEnvironment }] = await Promise.all([
        import("@modelcontextprotocol/sdk/client/index.js"),
        import("@modelcontextprotocol/sdk/client/stdio.js"),
      ]);
      if (tickets.get(config.name) !== ticket) throw new Error("Łączenie MCP anulowano.");
      const transport = new StdioClientTransport({ command: config.command, args: config.args,
        cwd: config.cwd, env: { ...getDefaultEnvironment(), ...config.env }, stderr: "pipe", maxBufferSize: 2 * 1024 * 1024 });
      const client = new Client({ name: "JARVIS", version: "2.1" }, { capabilities: {} });
      active = { client, transport, controller: new AbortController(), tools: new Set(), ready: false };
      clients.set(config.name, active);
      // Drain untrusted stderr without logging credentials or accumulating an unbounded pipe.
      transport.stderr?.on("data", () => {});
      await withTimeout(client.connect(transport), connectTimeout, "Serwer MCP nie odpowiedział podczas łączenia.", active.controller.signal);
      const listed = await withTimeout(client.listTools({}, { signal: active.controller.signal, timeout: connectTimeout }), connectTimeout, "Serwer MCP nie zwrócił listy narzędzi.", active.controller.signal);
      if (tickets.get(config.name) !== ticket || active.controller.signal.aborted) throw new Error("Łączenie MCP anulowano.");
      const tools = Array.isArray(listed?.tools) ? listed.tools.slice(0, 100).filter(tool => typeof tool.name === "string" && tool.name.length <= 128 && (!tool.inputSchema || (typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema) && JSON.stringify(tool.inputSchema).length <= 32000))).map((tool) => ({
        name: tool.name, description: String(tool.description || tool.name || "").slice(0, 4096),
        inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" && JSON.stringify(tool.inputSchema).length <= 32000 ? tool.inputSchema : { type: "object", properties: {} },
      })) : [];
      active.tools = new Set(tools.map(t => t.name)); active.ready = true;
      audit("connect", config.name, true, `${tools.length} tools`);
      return { ok: true, tools };
    } catch (error) {
      if (config?.name && clients.get(config.name) === active) clients.delete(config.name);
      if (config?.name && tickets.get(config.name) === ticket) tickets.delete(config.name);
      await dispose(active);
      audit("connect", config?.name || "", false, "Połączenie nie zostało potwierdzone; proces klienta zamknięty.");
      return { ok: false, error: error?.message || "Błąd połączenia MCP.", tools: [] };
    }
  }

  async function call(server, tool, args, execution = {}) {
    const active = clients.get(String(server || ""));
    if (!active?.ready) return { ok: false, error: "Serwer MCP nie jest połączony." };
    if (!active.tools.has(tool)) return { ok: false, error: "Narzędzie MCP nie należy do odkrytego katalogu." };
    if (!args || typeof args !== "object" || Array.isArray(args) || JSON.stringify(args).length > 128000) return { ok: false, error: "Niepoprawne lub zbyt duże argumenty MCP." };
    const controller = new AbortController();
    const abort = () => controller.abort();
    active.controller.signal.addEventListener("abort", abort, { once: true });
    execution.signal?.addEventListener("abort", abort, { once: true });
    if (active.controller.signal.aborted || execution.signal?.aborted) controller.abort();
    try {
      if (controller.signal.aborted) throw new Error("Anulowano MCP.");
      const result = await withTimeout(active.client.callTool({ name: tool, arguments: args }, undefined, { signal: controller.signal, timeout: callTimeout }), callTimeout,
        "Narzędzie MCP przekroczyło limit czasu; skutek wymaga sprawdzenia.", controller.signal);
      if (clients.get(server) !== active || controller.signal.aborted) throw new Error("Odrzucono spóźniony wynik MCP.");
      audit("call", server, !result?.isError, tool);
      return { ok: !result?.isError, result, ...(result?.isError ? { error: "Serwer zgłosił błąd narzędzia." } : {}) };
    } catch (error) {
      controller.abort(); // propagate cancellation notification to cooperating MCP servers
      audit("call", server, false, `${tool}: wywołanie przerwane lub niepotwierdzone`);
      return { ok: false, error: error?.message || "Niepotwierdzony wynik MCP.", uncertain: true };
    } finally {
      active.controller.signal.removeEventListener("abort", abort);
      execution.signal?.removeEventListener("abort", abort);
    }
  }

  async function closeAll() {
    tickets.clear();
    await Promise.all([...clients.keys()].map(close));
  }

  return { connect, call, close, closeAll, abortAll: closeAll };
}

module.exports = { ALLOWED_COMMANDS, cleanConfig, createStdioMcpManager };
