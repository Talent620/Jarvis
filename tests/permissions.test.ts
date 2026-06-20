// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requestConsent, setConsentHandler } from "../src/lib/permissions";
import { store } from "../src/lib/store";

beforeEach(() => { setConsentHandler(null); store.setSettings({ requireConsentAlways: false }); localStorage.clear(); });
afterEach(() => setConsentHandler(null));

describe("permissions — bramka zgód (opt-in fail-closed)", () => {
  it("akcja READ/lokalna przechodzi bez pytania", async () => {
    expect(await requestConsent("add_task", {})).toBe(true);
    expect(await requestConsent("list_tasks", {})).toBe(true);
  });

  it("domyślnie (zgodność wstecz): brak UI → akcja wychodząca NIE blokowana", async () => {
    store.setSettings({ requireConsentAlways: false });
    expect(await requestConsent("send_sms", { to: "x" })).toBe(true);
  });

  it("requireConsentAlways=true: brak UI → akcja wychodząca BLOKOWANA (fail-closed)", async () => {
    store.setSettings({ requireConsentAlways: true });
    expect(await requestConsent("send_sms", { to: "x" })).toBe(false);
    expect(await requestConsent("gmail_send", {})).toBe(false);
  });

  it("z handlerem UI: decyzja należy do handlera (mimo fail-closed)", async () => {
    store.setSettings({ requireConsentAlways: true });
    setConsentHandler(async () => ({ allow: true, remember: false }));
    expect(await requestConsent("make_call", {})).toBe(true);
  });
});
