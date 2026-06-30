import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import Toggle from "../src/components/Toggle";

// Toggle ma być DOSTĘPNY: semantyczny <button> (natywna klawiatura), role=switch,
// aria-checked odzwierciedla stan, aria-label dla czytników ekranu.
describe("Toggle — dostępność (a11y)", () => {
  it("renderuje semantyczny <button> z role=switch", () => {
    const html = renderToStaticMarkup(createElement(Toggle, { on: false, onClick: () => {}, label: "Tryb X" }));
    expect(html).toContain("<button");
    expect(html).toContain('role="switch"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Tryb X"');
  });

  it("aria-checked odzwierciedla stan on", () => {
    const onHtml = renderToStaticMarkup(createElement(Toggle, { on: true, onClick: () => {} }));
    const offHtml = renderToStaticMarkup(createElement(Toggle, { on: false, onClick: () => {} }));
    expect(onHtml).toContain('aria-checked="true"');
    expect(onHtml).toContain("switch on");
    expect(offHtml).toContain('aria-checked="false"');
  });
});
