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

it("uses existing panel form to pass exact changedetection and ntfy scopes, and clears the token field", async () => {
  const calls: any[] = [];
  const configured = [
    { id: "cd-owner", kind: "changedetection", label: "Zmiany strony", baseUrl: "https://watch.example.org/", configured: true },
    { id: "ntfy-owner", kind: "ntfy", label: "Mój kanał", baseUrl: "https://notify.example.org/", configured: true },
  ];
  (window as any).jarvisDesktop = {
    monitorCommand: async (request: any) => { if (request.action === "create") calls.push(request); return { ok: true, goals: [], events: [], grants: [], runtime: { active: true } }; },
    monitorGrant: async (request: any) => { calls.push({ action: "grant", ...request }); return { ok: true }; },
    monitorSettings: async () => ({ ok: true, backgroundEnabled: false }),
    monitorConnectorList: async () => ({ ok: true, connectors: configured }),
    monitorConnectorConfigure: async (request: any) => { calls.push({ action: "configure", ...request }); return { ok: true }; },
  };
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(GoalStatusPanel, { onClose: () => {} })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const byLabel = (text: string) => [...container.querySelectorAll("label")].find(label => label.textContent?.startsWith(text))!;
  const changeSelect = async (label: string, value: string) => {
    const input = byLabel(label).querySelector("select")!;
    await act(async () => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  const field = (form: HTMLFormElement, name: string, value: string) => { (form.elements.namedItem(name) as HTMLInputElement).value = value; };
  await changeSelect("Źródło", "changedetection");
  await changeSelect("Dodatkowy kanał", "ntfy-owner");
  const monitorForm = container.querySelector('input[name="contains"]')!.closest("form")!;
  field(monitorForm, "title", "Obserwuj zmiany"); field(monitorForm, "sourceConnector", "cd-owner");
  field(monitorForm, "source", "b8266333-03c2-4231-9c03-9870f2303c8b"); field(monitorForm, "contains", "*");
  await act(async () => { monitorForm.requestSubmit(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(calls.find(call => call.action === "grant")).toMatchObject({ source: { kind: "changedetection", connectorId: "cd-owner" }, desktopNotification: false, ntfyNotification: "ntfy-owner" });
  expect(calls.find(call => call.action === "create")).toMatchObject({ source: { kind: "changedetection", connectorId: "cd-owner" }, notification: { desktop: false, ntfy: "ntfy-owner" } });
  const configForm = container.querySelector('input[name="token"]')!.closest("form")!;
  field(configForm, "label", "Prywatny monitor"); field(configForm, "baseUrl", "https://watch.example.org/"); field(configForm, "token", "controlled-test-value");
  await act(async () => { configForm.requestSubmit(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(calls.find(call => call.action === "configure")).toMatchObject({ kind: "changedetection", allowLocal: false });
  expect((configForm.elements.namedItem("token") as HTMLInputElement).value).toBe("");
  expect(container.textContent).not.toContain("controlled-test-value");
});
