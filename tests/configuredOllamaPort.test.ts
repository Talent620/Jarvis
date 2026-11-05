import { createRequire } from "node:module";
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { configuredLocalPort, createConfiguredLocalOllamaManager } = require("../electron/local-ollama.cjs");
it("odczytuje port 11435 z konfiguracji i odrzuca hosty zdalne", () => {
  expect(configuredLocalPort("http://localhost:11435")).toBe(11435);
  for (const value of ["http://evil.test:11435", "http://localhost:11435/path", "http://user@localhost:11435", "http://localhost", "http://localhost:80"]) expect(configuredLocalPort(value)).toBeNull();
});
it("sprawdza faktycznie skonfigurowany port bez uruchamiania drugiej usługi", async () => {
  const server = createServer((_req, res) => res.end(JSON.stringify({ models: [] })));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const start = vi.fn();
  const manager = createConfiguredLocalOllamaManager({ start });
  try {
    expect(await manager.ensure(`http://127.0.0.1:${port}`)).toMatchObject({ ok: true, started: false });
    expect(start).not.toHaveBeenCalled();
    manager.close();
    expect(server.listening).toBe(true);
  } finally { manager.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
