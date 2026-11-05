// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { requestConsent, grantOutboundScope, clearOutboundScope, setAutoConsent, setConsentHandler } from "../src/lib/permissions";
import { store } from "../src/lib/store";
afterEach(() => { clearOutboundScope(); setAutoConsent(false); setConsentHandler(null); });
it("nowe nieznane narzędzie nie dziedziczy wildcard ani globalnej zgody", async () => {
  store.setSettings({ requireConsentAlways: false });
  setConsentHandler(null); grantOutboundScope("*"); setAutoConsent(true);
  expect(await requestConsent("mcp_unseen_ORION", {})).toBe(false);
  grantOutboundScope(["mcp_unseen_ORION"]);
  expect(await requestConsent("mcp_unseen_ORION", {})).toBe(true);
});
