import { describe, it, expect, afterEach } from "vitest";
import { classOf, decidePolicy, DEFAULT_POLICIES, requestConsent, setConsentHandler, grantOutboundScope, clearOutboundScope, setAutoConsent, riskOf } from "../../src/lib/permissions";
import { store } from "../../src/lib/store";

afterEach(() => {
  setConsentHandler(null);
  clearOutboundScope();
  setAutoConsent(false);
  store.setSettings({ permissionPolicies: undefined });
});

describe("action classes (mission 5.11)", () => {
  it("volume and media are local and reversible, not in the class of shutting down", () => {
    expect(classOf("desktop_volume")).toBe("LOCAL_REVERSIBLE");
    expect(classOf("desktop_media")).toBe("LOCAL_REVERSIBLE");
    expect(classOf("desktop_power")).toBe("DESTRUCTIVE");
    expect(riskOf("desktop_volume")).toBe("write");
  });

  it("runtime micro-actions have classes: reading, navigation, reversible, external", () => {
    expect(classOf("browser.findCollection")).toBe("READ");
    expect(classOf("browser.navigate")).toBe("NAVIGATE");
    expect(classOf("text.select")).toBe("LOCAL_REVERSIBLE");
    expect(classOf("clipboard.copy")).toBe("LOCAL_REVERSIBLE");
    expect(classOf("mail.send")).toBe("EXTERNAL_SIDE_EFFECT");
    expect(classOf("some_mcp_tool")).toBe("EXTERNAL_SIDE_EFFECT"); // unknown tools stay fail-safe
  });

  it("defaults: reading/scrolling/selecting/copying AUTO, mail ASK, destructive ASK", () => {
    expect(DEFAULT_POLICIES).toMatchObject({ READ: "AUTO", NAVIGATE: "AUTO", LOCAL_REVERSIBLE: "AUTO", EXTERNAL_SIDE_EFFECT: "ASK", DESTRUCTIVE: "ASK" });
  });

  it("destructive can never be AUTO; untrusted content + external effect is always ASK", () => {
    expect(decidePolicy("DESTRUCTIVE", {}, { DESTRUCTIVE: "AUTO" })).toBe("ASK");
    expect(decidePolicy("EXTERNAL_SIDE_EFFECT", {}, { EXTERNAL_SIDE_EFFECT: "AUTO" })).toBe("AUTO");
    expect(decidePolicy("EXTERNAL_SIDE_EFFECT", { untrustedContent: true }, { EXTERNAL_SIDE_EFFECT: "AUTO" })).toBe("ASK");
    expect(decidePolicy("EXTERNAL_SIDE_EFFECT", { privateData: true }, { EXTERNAL_SIDE_EFFECT: "AUTO" })).toBe("ASK");
    expect(decidePolicy("LOCAL_WRITE", {}, { LOCAL_WRITE: "DENY" })).toBe("DENY");
  });

  it("requestConsent: volume passes without asking, power always asks even with a session scope", async () => {
    let asked = 0;
    setConsentHandler(async () => { asked++; return { allow: false, remember: true }; });
    grantOutboundScope("*");
    setAutoConsent(true);
    expect(await requestConsent("desktop_volume", { action: "up" })).toBe(true);
    expect(asked).toBe(0);
    expect(await requestConsent("desktop_power", { action: "shutdown" })).toBe(false);
    expect(asked).toBe(1);
  });

  it("a user policy can make local writes ask and deny a class entirely", async () => {
    let asked = 0;
    setConsentHandler(async () => { asked++; return { allow: true, remember: false }; });
    store.setSettings({ permissionPolicies: { LOCAL_WRITE: "ASK", NAVIGATE: "DENY" } });
    expect(await requestConsent("add_task", { title: "x" })).toBe(true);
    expect(asked).toBe(1);
    expect(await requestConsent("open_url", { url: "https://example.com" })).toBe(false);
  });
});
