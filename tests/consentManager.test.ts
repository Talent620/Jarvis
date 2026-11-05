// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import ConsentManager from "../src/components/ConsentManager";
import { listRememberedConsents } from "../src/lib/permissions";

it("pozwala zobaczyć i cofnąć pojedynczą zapamiętaną zgodę", () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem("jarvis.consents.v1", JSON.stringify({ desktop_open: "allow", open_service: "allow" }));
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  act(() => root.render(createElement(ConsentManager)));
  const button = div.querySelector<HTMLButtonElement>('[aria-label="Cofnij zgodę desktop_open"]');
  expect(button).not.toBeNull();
  act(() => button!.click());
  expect(listRememberedConsents()).toEqual(["open_service"]);
  expect(div.textContent).toContain("open_service");
  expect(div.querySelector('[aria-label="Cofnij zgodę desktop_open"]')).toBeNull();
  act(() => root.unmount());
  localStorage.removeItem("jarvis.consents.v1");
  div.remove();
});
