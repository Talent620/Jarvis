// @vitest-environment jsdom
// Controlled React/IPC integration, real durable store. This is not a native desktop or LLM test.
import { afterEach, expect, it } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import GoalStatusPanel from "../src/components/GoalStatusPanel";
const require = createRequire(import.meta.url);
const { createGoalService } = require("../electron/goal-service.cjs");
let directory: string | undefined;
let service: any;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  if (service) await service.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
  delete (window as any).jarvisDesktop;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  document.body.innerHTML = "";
});

it("renders actual runtime error objects and match reasons, and explicit UI read acknowledgement persists", async () => {
  directory = await mkdtemp(join(tmpdir(), "jarvis-monitor-panel-"));
  const now = Date.parse("2026-11-05T13:00:00Z");
  let status = 200;
  service = createGoalService({ directory, now: () => now, fetch: async () => ({ status, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ items: [{ id: "offer-1", title: "Lampa Orion", available: true, url: "https://example.org/offer-1", price: 300, shipping: 20, currency: "PLN" }] }) }) });
  const source = { kind: "json", url: "https://example.org/feed" };
  await service.command({ action: "grant", source }, { trustedUserAction: true });
  const contract = { action: "create", title: "Lampa", originalCommand: "Obserwuj lampę", source, criteria: { contains: "Orion" }, intervalMs: 60000 };
  await service.command(contract); await service.tick();
  status = 403;
  await service.command({ ...contract, title: "Drugie źródło wymaga dostępu" }); await service.tick();
  const saved = await service.command({ action: "list" });
  expect(saved.events).toHaveLength(1);
  expect(saved.goals[1].lastError).toMatchObject({ code: "SOURCE_AUTH" });
  (window as any).jarvisDesktop = {
    monitorCommand: async (request: unknown) => ({ ok: true, ...(await service.command(request)) }),
    monitorReadEvent: async (id: string) => ({ ok: true, ...(await service.command({ action: "read_event", id }, { trustedUserAction: true })) }),
    monitorSettings: async () => ({ ok: true, backgroundEnabled: false }),
  };
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(GoalStatusPanel, { onClose: () => {} })); });
  for (let attempt = 0; attempt < 50 && !container.textContent?.includes("Źródło odmawia dostępu (403)"); attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
  expect(container.textContent).toContain("Źródło odmawia dostępu (403)");
  expect(container.textContent).toContain("dopasowanie znalezione — zakończony");
  expect(container.textContent).toContain("Nazwa zawiera: Orion");
  expect(container.textContent).not.toContain("[object Object]");
  const readButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Oznacz jako przeczytane");
  expect(readButton).toBeDefined();
  await act(async () => { readButton!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect((await service.command({ action: "list" })).events[0].readAt).toBe(now);
});
