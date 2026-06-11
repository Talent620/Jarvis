// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { toast, copyWithToast } from "../src/lib/toast";

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
    Object.assign(navigator, { clipboard: { writeText } });
    await copyWithToast("sekretny tekst");
    expect(writeText).toHaveBeenCalledWith("sekretny tekst");
    expect(document.querySelector(".toast")?.textContent).toMatch(/Skopiowano/);
  });

  it("brak schowka → czytelny komunikat zamiast wyjątku", async () => {
    Object.assign(navigator, { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
    await copyWithToast("x");
    expect(document.querySelector(".toast")?.textContent).toMatch(/Nie mogę skopiować/);
  });
});
