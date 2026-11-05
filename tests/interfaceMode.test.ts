// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import InterfaceSwitch from "../src/components/InterfaceSwitch";
import { applyInterfaceCommand, parseInterfaceCommand } from "../src/lib/interfaceMode";
import { store } from "../src/lib/store";

const original = store.settings.interfaceMode;
afterEach(() => { store.setSettings({ interfaceMode: original }); });

describe("wybór interfejsu", () => {
  it.each([
    ["Przełącz na nowy interfejs", "modern"],
    ["Zmień mi interfejs na ten nowy", "modern"],
    ["Zmień wygląd na nowy", "modern"],
    ["Włącz klasyczny interfejs", "classic"],
    ["Wróć do starego wyglądu", "classic"],
    ["Jak zmienić wygląd strony klienta?", null],
    ["Nowy interfejs", null],
    ["Zmień nowy interfejs na stary", null],
  ])("rozpoznaje %s", (text, result) => expect(parseInterfaceCommand(text)).toBe(result));

  it("wykonuje komendę bez aktywnego projektu i modelu", () => {
    const prev = store.settings.activeProjectId;
    store.setSettings({ activeProjectId: "" });
    expect(applyInterfaceCommand("Zmień mi interfejs na nowy")).toBe("Włączyłem nowy interfejs.");
    expect(store.settings.interfaceMode).toBe("modern");
    store.setSettings({ activeProjectId: prev });
  });

  it("przełącza obie kontrolki, zapisuje wybór i pozostawia dane aplikacji", () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    store.setSettings({ interfaceMode: undefined });
    const data = store.data;
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    act(() => root.render(createElement(Fragment, null, createElement(InterfaceSwitch), createElement(InterfaceSwitch))));
    const buttons = () => [...div.querySelectorAll("button")];
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("true");
    act(() => buttons()[1].click());
    expect(buttons()[1].getAttribute("aria-pressed")).toBe("true");
    expect(buttons()[3].getAttribute("aria-pressed")).toBe("true");
    expect(store.settings.interfaceMode).toBe("modern");
    const key = Object.keys(localStorage).find(k => localStorage.getItem(k)?.includes('"interfaceMode":"modern"'));
    expect(key).toBeTruthy();
    const saved = localStorage.getItem(key!);
    act(() => store.setSettings({ interfaceMode: "classic" }));
    localStorage.setItem(key!, saved!);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: key! })));
    expect(store.settings.interfaceMode).toBe("modern");
    expect(buttons()[1].getAttribute("aria-pressed")).toBe("true");
    expect(store.data).toBe(data);
    act(() => buttons()[2].click());
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(store.settings.interfaceMode).toBe("classic");
    act(() => root.unmount());
    div.remove();
  });
});
