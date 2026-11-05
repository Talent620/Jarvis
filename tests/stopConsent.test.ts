// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { runTool } from "../src/lib/tools";
import { setConsentHandler, listRememberedConsents, resetConsents, setAutoConsent, clearOutboundScope } from "../src/lib/permissions";

afterEach(() => { setConsentHandler(null); vi.unstubAllGlobals(); });
it("STOP podczas pytania o zgodę blokuje nawet późniejsze zaakceptowanie", async () => {
  resetConsents(); setAutoConsent(false); clearOutboundScope();
  const controller = new AbortController();
  let answer!: (value: { allow: boolean; remember: boolean }) => void;
  setConsentHandler(() => new Promise(resolve => { answer = resolve; }));
  const open = vi.fn(async () => "ok");
  Object.assign(window, { jarvisDesktop: { platform: "linux", open } });
  try {
    const pending = runTool("desktop_open", { target: "/tmp/orion" }, { signal: controller.signal });
    controller.abort();
    answer({ allow: true, remember: true });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(open).not.toHaveBeenCalled();
    expect(listRememberedConsents()).not.toContain("desktop_open");
  } finally { delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop; }
});
