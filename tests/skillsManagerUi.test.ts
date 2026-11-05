// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SkillsManager } from "../src/components/SkillsManager";
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); delete (window as any).jarvisDesktop; delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; document.body.innerHTML = ""; });
async function render(bridge: object) {
  Object.assign(window, { jarvisDesktop: bridge }); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => { root!.render(createElement(SkillsManager)); });
  return node;
}
const button = (node: HTMLElement, text: string) => [...node.querySelectorAll("button")].find(element => element.textContent === text)!;
it("shows the bounded search result and opens authored-source policy with the exact license", async () => {
  const candidates = [{ candidateId: "one", publisher: "p", name: "wanted", version: "1", license: "MIT", description: "matches" }, { candidateId: "two", publisher: "p", name: "unrelated", version: "1", license: "MIT", description: "other" }];
  const policy = vi.fn(async () => ({ ok: true }));
  const node = await render({ skillPolicy: policy, skillCommand: async (request: any) => request.action === "search" ? { ok: true, candidates: [candidates[0]] } : { ok: true, candidates, skills: [{ id: "jarvis-self/generated@1", source: { kind: "authored" }, name: "generated", publisher: "jarvis-self", version: "1", description: "generated", hash: "abc", license: "LicenseRef-Owner-Generated", permissions: ["files.read"], codeKind: "executable", state: "QUARANTINED", test: { status: "MISSING_CONFIGURATION", ok: false } }] } });
  await act(async () => { button(node, "Szukaj umiejętności").click(); });
  expect(node.querySelectorAll("article strong")[0].textContent).toBe("p/wanted");
  expect([...node.querySelectorAll("article strong")].some(element => element.textContent === "p/unrelated")).toBe(false);
  await act(async () => { button(node, "Ustaw zakres dla tego źródła").click(); });
  const detail = [...node.querySelectorAll("details")].find(element => element.querySelector("summary")?.textContent === "Polityka właściciela i lokalny projekt")!;
  expect(detail.open).toBe(true);
  await act(async () => { button(node, "Zatwierdź zakres").click(); });
  expect(policy).toHaveBeenCalledWith({ source: "jarvis:self", codeKinds: ["executable"], permissions: ["files.read"], licenses: ["LicenseRef-Owner-Generated"], enabled: true });
});
it("keeps browser STOP usable while a status request is pending and ignores its late response", async () => {
  let resolve!: (value: object) => void;
  const browserCommand = vi.fn(request => request.action === "status" ? new Promise(done => { resolve = done; }) : Promise.resolve({ ok: true, stopped: true }));
  const node = await render({ skillCommand: async () => ({ ok: true }), browserGrant: async () => ({ ok: true }), browserCommand });
  await act(async () => { button(node, "Sprawdź stan").click(); });
  const stop = button(node, "Zatrzymaj przeglądarkę"); expect(stop.matches(":disabled")).toBe(false);
  await act(async () => { stop.click(); });
  await act(async () => { resolve({ ok: true, active: true }); });
  expect(node.textContent).toContain('"stopped": true'); expect(node.textContent).not.toContain('"active": true');
});
