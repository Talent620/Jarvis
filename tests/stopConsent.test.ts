// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { runTool } from "../src/lib/tools";
import { setConsentHandler, listRememberedConsents, resetConsents, setAutoConsent, clearOutboundScope } from "../src/lib/permissions";

afterEach(() => { setConsentHandler(null); vi.unstubAllGlobals(); });
it("STOP podczas pytania o zgodę blokuje nawet późniejsze zaakceptowanie", async () => {
  resetConsents(); setAutoConsent(false); clearOutboundScope();
  const controller = new AbortController();
  let answer!: (value: { allow: boolean; remember: boolean }) => void;
  let ready!: () => void;
  const consentReady = new Promise<void>(resolve => { ready = resolve; });
  setConsentHandler(() => new Promise(resolve => { answer = resolve; ready(); }));
  const open = vi.fn(async () => "ok");
  Object.assign(window, { jarvisDesktop: { platform: "linux", open } });
  try {
    const pending = runTool("desktop_open", { target: "/tmp/orion" }, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await consentReady; // STOP must occur while the real consent handler is pending.
    controller.abort();
    answer({ allow: true, remember: true });
    await rejected;
    expect(open).not.toHaveBeenCalled();
    expect(listRememberedConsents()).not.toContain("desktop_open");
  } finally { delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop; }
});
