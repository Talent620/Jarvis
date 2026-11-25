// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Modal from "../src/components/Modal";
import Help from "../src/components/Help";

afterEach(() => {
  document.body.innerHTML = "";
  document.body.className = "";
});

describe("F-09 — wszystkie 34 komponenty dialogowe (.sheet i Modal) współdzielą jeden focus-trap, Escape i pełne ARIA", () => {
  const files = readdirSync("src/components").filter((f) => f.endsWith(".tsx") && f !== "ScreenSkeleton.tsx");
  const sheetFiles = files.filter((f) => {
    const s = readFileSync(`src/components/${f}`, "utf8");
    return /className="sheet"|className=\{`sheet/.test(s);
  });

  it("obejmuje dokładnie Modal.tsx + 33 starsze arkusze .sheet i w każdym używa wspólnego useModalFocusTrap oraz useEscape", () => {
    expect(sheetFiles.length).toBe(34);
    for (const file of sheetFiles) {
      const src = readFileSync(`src/components/${file}`, "utf8");
      expect(src, `${file}: brak useModalFocusTrap`).toContain("useModalFocusTrap");
      expect(src, `${file}: brak useEscape`).toContain("useEscape");
      expect(src, `${file}: brak role="dialog"`).toContain('role="dialog"');
      expect(src, `${file}: brak aria-modal="true"`).toContain('aria-modal="true"');

      if (file !== "Modal.tsx") {
        const dialogTags = src.match(/<div[^>]*role="dialog"[^>]*>/g) || [];
        expect(dialogTags.length, `${file}: brak znacznika dialogu`).toBeGreaterThan(0);
        for (const tag of dialogTags) {
          expect(tag, `${file}: brak {...dialogTrap} na .panel`).toContain("{...dialogTrap}");
          expect(
            /aria-label=|aria-labelledby=/.test(tag),
            `${file}: brak aria-label lub aria-labelledby na role="dialog"`,
          ).toBe(true);
        }
      }
    }
  });

  it("w żywym drzewie React zawija Tab/Shift+Tab wewnątrz arkusza, ustawia body.sheet-open, reaguje na Escape i przywraca fokus po zamknięciu", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const opener = document.createElement("button");
    opener.textContent = "Otwórz Pomoc";
    const bgButton = document.createElement("button");
    bgButton.textContent = "Przycisk w tle";
    document.body.append(opener, bgButton);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    let closedCount = 0;
    const root = createRoot(host);
    flushSync(() => {
      root.render(React.createElement(Help, { onClose: () => { closedCount += 1; } }));
    });

    expect(document.body.classList.contains("sheet-open")).toBe(true);
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBeTruthy();

    // Po otwarciu fokus znajduje się wewnątrz modala (pierwszy przycisk .panel-close)
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"));
    expect(focusables.length).toBeGreaterThanOrEqual(2);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);

    // Shift+Tab na pierwszym elemencie zawija fokus na ostatni element wewnątrz modala (nie ucieka na tło)
    const shiftTabEvt = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    dialog.dispatchEvent(shiftTabEvt);
    expect(shiftTabEvt.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);

    // Tab na ostatnim elemencie zawija fokus z powrotem na pierwszy element wewnątrz modala
    const tabEvt = new KeyboardEvent("keydown", { key: "Tab", shiftKey: false, bubbles: true, cancelable: true });
    dialog.dispatchEvent(tabEvt);
    expect(tabEvt.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);

    // Escape wywołuje zamknięcie okna
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(closedCount).toBe(1);

    // Po zamknięciu (unmount) klasa body.sheet-open znika, a fokus wraca na przycisk wywołujący
    flushSync(() => {
      root.unmount();
    });
    expect(document.body.classList.contains("sheet-open")).toBe(false);
    expect(document.activeElement).toBe(opener);

    // Kanoniczny <Modal> korzysta z dokładnie tego samego mechanizmu
    opener.focus();
    const root2 = createRoot(host);
    flushSync(() => {
      root2.render(
        React.createElement(
          Modal,
          { title: "Test Kanoniczny", onClose: () => { closedCount += 1; } },
          React.createElement("button", { type: "button" }, "Akcja"),
        ),
      );
    });
    expect(document.body.classList.contains("sheet-open")).toBe(true);
    flushSync(() => {
      root2.unmount();
    });
    expect(document.body.classList.contains("sheet-open")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

describe("F-02 & F-08 — ochrona .toast przed nakładaniem na nagłówek .sheet oraz czytelność body.theme-light .onboard input", () => {
  const css = readFileSync("src/styles/index.css", "utf8");

  it("dokuje widoczny .toast (z-index: 1000) nad stopką przy otwartym .sheet (body.sheet-open .toast)", () => {
    expect(css).toMatch(/\.toast\s*\{[\s\S]*?z-index:\s*1000;/);
    expect(css).toMatch(/body\.sheet-open\s+\.toast\s*\{[\s\S]*?top:\s*auto;[\s\S]*?bottom:\s*calc\(74px\s*\+\s*var\(--sab\)\);/);
  });

  it("zapewnia jasne tło i ciemny tekst dla body.theme-light .onboard input", () => {
    expect(css).toMatch(/body\.theme-light\s+\.onboard\s+input\s*\{[^}]*background:\s*#ffffff;[^}]*color:\s*#0f172a;/);
  });
});
