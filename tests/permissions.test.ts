// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requestConsent, setConsentHandler, grantOutboundScope, clearOutboundScope } from "../src/lib/permissions";
import { store } from "../src/lib/store";

beforeEach(() => { setConsentHandler(null); clearOutboundScope(); store.setSettings({ requireConsentAlways: false }); localStorage.clear(); });
afterEach(() => { setConsentHandler(null); clearOutboundScope(); });

describe("permissions — bramka zgód (fail-closed dla outbound bez UI)", () => {
  it("akcja READ/lokalna przechodzi bez pytania", async () => {
    expect(await requestConsent("add_task", {})).toBe(true);
    expect(await requestConsent("list_tasks", {})).toBe(true);
  });

  it("brak UI → akcja wychodząca BLOKOWANA (fail-closed, bez globalnego fail-open)", async () => {
    store.setSettings({ requireConsentAlways: false });
    expect(await requestConsent("send_sms", { to: "x" })).toBe(false);
    expect(await requestConsent("gmail_send", {})).toBe(false);
    expect(await requestConsent("make_call", {})).toBe(false);
  });

  it("Live/headless: jawny ograniczony zakres przepuszcza TYLKO objęte narzędzia", async () => {
    grantOutboundScope(["send_sms"], 60_000);
    expect(await requestConsent("send_sms", { to: "x" })).toBe(true); // w zakresie
    expect(await requestConsent("gmail_send", {})).toBe(false); // poza zakresem
    clearOutboundScope();
    expect(await requestConsent("send_sms", { to: "x" })).toBe(false); // po wyczyszczeniu znów blok
  });

  it("zakres wygasa po TTL (nie zostaje otwarty na stałe)", async () => {
    grantOutboundScope("*", 0); // natychmiast wygasły
    expect(await requestConsent("send_sms", { to: "x" })).toBe(false);
  });

  it("z handlerem UI: decyzja należy do handlera", async () => {
    setConsentHandler(async () => ({ allow: true, remember: false }));
    expect(await requestConsent("make_call", {})).toBe(true);
  });

  it("handler odmawia → akcja zablokowana", async () => {
    setConsentHandler(async () => ({ allow: false, remember: false }));
    expect(await requestConsent("gmail_send", {})).toBe(false);
  });
});
