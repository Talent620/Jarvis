// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requestConsent, setConsentHandler, grantOutboundScope, clearOutboundScope, setAutoConsent, listRememberedConsents, revokeConsent, resetConsents } from "../src/lib/permissions";
import { store } from "../src/lib/store";

beforeEach(() => { setConsentHandler(null); setAutoConsent(false); clearOutboundScope(); store.setSettings({ requireConsentAlways: false }); localStorage.clear(); });
afterEach(() => { setConsentHandler(null); setAutoConsent(false); clearOutboundScope(); });

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
    grantOutboundScope(["desktop_open"], 60_000);
    expect(await requestConsent("desktop_open", { target: "x" })).toBe(true); // w zakresie
    expect(await requestConsent("gmail_send", {})).toBe(false); // poza zakresem
    clearOutboundScope();
    expect(await requestConsent("desktop_open", { target: "x" })).toBe(false); // po wyczyszczeniu znów blok
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
  it("zawsze potwierdzaj blokuje zapamiętaną i sesyjną zgodę bez UI", async () => {
    localStorage.setItem("jarvis.consents.v1", JSON.stringify({ desktop_open: "allow" }));
    grantOutboundScope("*"); setAutoConsent(true);
    store.setSettings({ requireConsentAlways: true });
    expect(await requestConsent("desktop_open", { target: "x" })).toBe(false);
    let calls = 0;
    setConsentHandler(async (req) => { calls++; expect(req.freshOnly).toBe(true); return { allow: true, remember: true }; });
    expect(await requestConsent("desktop_open", { target: "x" })).toBe(true);
    expect(await requestConsent("desktop_open", { target: "y" })).toBe(true);
    expect(calls).toBe(2);
  });

  it("wysyłka wymaga osobnego zatwierdzenia mimo zapamiętanej zgody, sesji i trybu Szefa", async () => {
    localStorage.setItem("jarvis.consents.v1", JSON.stringify({ gmail_send: "allow" }));
    grantOutboundScope("*"); setAutoConsent(true);
    expect(await requestConsent("gmail_send", { to: "pierwszy@example.test" })).toBe(false);
    let count = 0;
    setConsentHandler(async (req) => { count++; expect(req.freshOnly).toBe(true); return { allow: true, remember: true }; });
    expect(await requestConsent("gmail_send", { to: "pierwszy@example.test" })).toBe(true);
    expect(await requestConsent("gmail_send", { to: "inny@example.test" })).toBe(true);
    expect(count).toBe(2);
  });

  it("wyświetla i cofa pojedyncze trwałe zgody", async () => {
    setConsentHandler(async () => ({ allow: true, remember: true }));
    expect(await requestConsent("desktop_open", {})).toBe(true);
    expect(listRememberedConsents()).toEqual(["desktop_open"]);
    expect(revokeConsent("desktop_open")).toBe(true);
    setConsentHandler(null);
    expect(await requestConsent("desktop_open", {})).toBe(false);
    expect(listRememberedConsents()).toEqual([]);
  });

  it("nie akceptuje niepoprawnego formatu zapisanych zgód", async () => {
    localStorage.setItem("jarvis.consents.v1", "null");
    expect(listRememberedConsents()).toEqual([]);
    expect(await requestConsent("desktop_open", {})).toBe(false);
    expect(resetConsents()).toBe(true);
  });

});
