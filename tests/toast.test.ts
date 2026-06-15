// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { toast, copyWithToast, copyText, shareOrCopy } from "../src/lib/toast";

function setNav(prop: "share" | "clipboard", value: unknown) {
  Object.defineProperty(navigator, prop, { configurable: true, writable: true, value });
}
afterEach(() => {
  setNav("share", undefined);
  setNav("clipboard", undefined);
  vi.restoreAllMocks();
});

describe("toast", () => {
  it("tworzy jeden element i podmienia treść (bez duplikatów)", () => {
    toast("Pierwszy");
    toast("Drugi");
    const els = document.querySelectorAll(".toast");
    expect(els.length).toBe(1);
    expect(els[0].textContent).toBe("Drugi");
    expect(els[0].classList.contains("show")).toBe(true);
  });

  it("copyWithToast kopiuje do schowka i potwierdza", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setNav("clipboard", { writeText });
    await copyWithToast("sekretny tekst");
    expect(writeText).toHaveBeenCalledWith("sekretny tekst");
    expect(document.querySelector(".toast")?.textContent).toMatch(/Skopiowano/);
  });

  it("brak schowka → czytelny komunikat zamiast wyjątku", async () => {
    setNav("clipboard", { writeText: () => Promise.reject(new Error("denied")) });
    (document as unknown as { execCommand?: () => boolean }).execCommand = () => false;
    await copyWithToast("x");
    expect(document.querySelector(".toast")?.textContent).toMatch(/Nie mogę skopiować/);
  });
});

describe("copyText — kopiowanie z fallbackiem", () => {
  it("używa Clipboard API gdy dostępne", async () => {
    const writeText = vi.fn(async () => {});
    setNav("clipboard", { writeText });
    expect(await copyText("abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("brak Clipboard API → fallback execCommand", async () => {
    setNav("clipboard", undefined);
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText("xyz")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });
});

describe("shareOrCopy — udostępnij albo skopiuj", () => {
  it("udane udostępnienie nie kopiuje", async () => {
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    setNav("share", share);
    setNav("clipboard", { writeText });
    await shareOrCopy("tekst");
    expect(share).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("anulowanie (AbortError) NIE kopiuje", async () => {
    const err = new Error("cancel"); err.name = "AbortError";
    const share = vi.fn(async () => { throw err; });
    const writeText = vi.fn(async () => {});
    setNav("share", share);
    setNav("clipboard", { writeText });
    await shareOrCopy("tekst");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("inny błąd udostępniania → kopiuje jako fallback", async () => {
    const share = vi.fn(async () => { throw new Error("boom"); });
    const writeText = vi.fn(async () => {});
    setNav("share", share);
    setNav("clipboard", { writeText });
    await shareOrCopy("tekst");
    expect(writeText).toHaveBeenCalledWith("tekst");
  });

  it("brak Web Share → od razu kopiuje", async () => {
    setNav("share", undefined);
    const writeText = vi.fn(async () => {});
    setNav("clipboard", { writeText });
    await shareOrCopy("tekst");
    expect(writeText).toHaveBeenCalledWith("tekst");
  });
});
