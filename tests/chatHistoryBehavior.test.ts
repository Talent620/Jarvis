// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ChatHistory from "../src/components/ChatHistory";
import { loadChats, saveChats, type ChatSession } from "../src/lib/chats";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const session = (id: string): ChatSession => ({ id, title: id, updatedAt: 1, messages: [{ id: `m-${id}`, role: "user", text: "Treść rozmowy", createdAt: 1 }] });
const click = (selector: string) => act(() => { const button = container.querySelector<HTMLButtonElement>(selector); expect(button).not.toBeNull(); button!.click(); });
beforeEach(() => {
  localStorage.clear(); saveChats([session("active"), session("other")]);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); localStorage.clear(); });
const mount = (onRemoved = vi.fn()) => {
  act(() => root.render(createElement(ChatHistory, { activeId: "active", onOpen: vi.fn(), onClose: vi.fn(), onRemoved })));
  return onRemoved;
};

describe("chat history deletion", () => {
  it("notifies the active conversation owner only after successful deletion", () => {
    const onRemoved = mount();
    click('[aria-label="Usuń rozmowę"]');
    expect(loadChats().map((chat) => chat.id)).toEqual(["other"]);
    expect(onRemoved).toHaveBeenCalledWith(["active"]);
  });
  it("does not show deletion or notify the owner when storage rejects the change", () => {
    const onRemoved = mount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    click('[aria-label="Usuń rozmowę"]');
    expect(loadChats()).toHaveLength(2);
    expect(onRemoved).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Nie udało się zapisać");
    expect(container.querySelectorAll('[aria-label="Usuń rozmowę"]')).toHaveLength(2);
  });
  it("preserves newer messages in other chats when deleting from an older view", () => {
    mount();
    const newer = session("other"); newer.messages.push({ id: "new", role: "assistant", text: "Nowszy wynik", createdAt: 2 });
    saveChats([session("active"), newer]);
    click('[aria-label="Usuń rozmowę"]');
    expect(loadChats()[0].messages.at(-1)?.text).toBe("Nowszy wynik");
  });
  it("clears all only after confirmation and reports the exact removed sessions", () => {
    const onRemoved = mount();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const clear = () => act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Wyczyść historię")!.click());
    clear(); expect(loadChats()).toHaveLength(2); expect(onRemoved).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); clear();
    expect(loadChats()).toEqual([]); expect(onRemoved).toHaveBeenCalledWith(["active", "other"]);
  });
});
