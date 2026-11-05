// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PermissionDialog from "../src/components/PermissionDialog";
import {
  askConsentUI, clearOutboundScope, createConsentPresenter, requestConsent,
  resetConsents, setAutoConsent, setConsentHandler, type PendingConsent,
} from "../src/lib/permissions";
import { store } from "../src/lib/store";

vi.mock("../src/lib/feedback", () => ({ feedback: vi.fn() }));
vi.mock("../src/lib/voice", () => ({ isSpeechSupported: () => false, speak: vi.fn(), stopSpeaking: vi.fn(), createListener: vi.fn() }));

const allow = { allow: true, remember: false };
const deny = { allow: false, remember: false };

function presenter() {
  const state: { current: PendingConsent | null; shown: string[] } = { current: null, shown: [] };
  setConsentHandler(createConsentPresenter((update) => {
    const previous = state.current;
    state.current = update(previous);
    if (state.current && state.current !== previous) state.shown.push(state.current.req.tool);
  }));
  return state;
}

beforeEach(() => {
  setConsentHandler(null); resetConsents(); clearOutboundScope(); setAutoConsent(false);
});
afterEach(() => {
  setConsentHandler(null); resetConsents(); clearOutboundScope(); setAutoConsent(false);
  vi.restoreAllMocks();
});

describe("concurrent consent requests", () => {
  it("presents chat, background work and hard-boundary consent in FIFO order", async () => {
    const state = presenter();
    const first = requestConsent("send_sms", { to: "first" });
    const second = requestConsent("gmail_send", { to: "second" });
    const third = askConsentUI({ tool: "payment", input: {}, risk: "outbound" });
    expect(state.shown).toEqual(["send_sms"]);
    state.current!.resolve(allow);
    await expect(first).resolves.toBe(true);
    await vi.waitFor(() => expect(state.current?.req.tool).toBe("gmail_send"));
    state.current!.resolve(deny);
    await expect(second).resolves.toBe(false);
    await vi.waitFor(() => expect(state.current?.req.tool).toBe("payment"));
    state.current!.resolve(allow);
    await expect(third).resolves.toEqual({ allow: true });
    expect(state.shown).toEqual(["send_sms", "gmail_send", "payment"]);
    expect(state.current).toBeNull();
  });

  it("removes an aborted queued request without ever opening its dialog", async () => {
    const state = presenter();
    const controller = new AbortController();
    const first = requestConsent("send_sms", {});
    const cancelled = requestConsent("gmail_send", {}, controller.signal);
    const last = requestConsent("make_call", {});
    controller.abort();
    await expect(cancelled).resolves.toBe(false);
    expect(state.shown).toEqual(["send_sms"]);
    state.current!.resolve(deny);
    await first;
    await vi.waitFor(() => expect(state.current?.req.tool).toBe("make_call"));
    state.current!.resolve(deny);
    await last;
    expect(state.shown).toEqual(["send_sms", "make_call"]);
  });

  it("aborting the visible request releases the next request without approving either", async () => {
    const state = presenter();
    const controller = new AbortController();
    const first = requestConsent("send_sms", {}, controller.signal);
    const second = requestConsent("gmail_send", {});
    controller.abort();
    await expect(first).resolves.toBe(false);
    await vi.waitFor(() => expect(state.current?.req.tool).toBe("gmail_send"));
    state.current!.resolve(deny);
    await expect(second).resolves.toBe(false);
    expect(state.current).toBeNull();
  });

  it("a late answer from an aborted dialog cannot dismiss, approve or remember the next request", async () => {
    const state = presenter();
    const controller = new AbortController();
    const first = requestConsent("send_sms", {}, controller.signal);
    const obsolete = state.current!;
    const second = requestConsent("gmail_send", {});
    controller.abort();
    await first;
    await vi.waitFor(() => expect(state.current?.req.tool).toBe("gmail_send"));
    const current = state.current;
    obsolete.resolve({ allow: true, remember: true });
    await Promise.resolve();
    expect(state.current).toBe(current);
    expect(localStorage.getItem("jarvis.consents.v1")).not.toContain("send_sms");
    state.current!.resolve(deny);
    await expect(second).resolves.toBe(false);
  });

  it("detaching the UI denies all waiting callers and closes its current dialog", async () => {
    const state = presenter();
    const first = requestConsent("send_sms", {});
    const second = requestConsent("gmail_send", {});
    setConsentHandler(null);
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(state.current).toBeNull();
    expect(state.shown).toEqual(["send_sms"]);
  });

  it("a failing presenter does not strand the remaining queue", async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error("dialog unavailable")).mockResolvedValue(allow);
    setConsentHandler(handler);
    await expect(Promise.all([requestConsent("send_sms", {}), requestConsent("gmail_send", {})])).resolves.toEqual([false, true]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("remembered approvals from two queued dialogs do not overwrite each other", async () => {
    const state = presenter();
    const first = requestConsent("send_sms", {});
    const second = requestConsent("gmail_send", {});
    state.current!.resolve({ allow: true, remember: true });
    await first;
    await vi.waitFor(() => expect(state.current?.req.tool).toBe("gmail_send"));
    state.current!.resolve({ allow: true, remember: true });
    await second;
    setConsentHandler(null);
    await expect(requestConsent("send_sms", {})).resolves.toBe(true);
    await expect(requestConsent("gmail_send", {})).resolves.toBe(true);
  });
});

describe("consent dialog presentation", () => {
  it("a second request for the same tool has a fresh checkbox and accepts its own decision", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const oldVoiceConfirm = store.settings.voiceConfirm;
    store.setSettings({ voiceConfirm: false });
    function Harness() {
      const [pending, setPending] = useState<PendingConsent | null>(null);
      useEffect(() => { setConsentHandler(createConsentPresenter(setPending)); return () => setConsentHandler(null); }, []);
      return pending && <PermissionDialog key={pending.id} req={pending.req} onDecision={(allow, remember) => pending.resolve({ allow, remember })} />;
    }
    try {
      await act(async () => root.render(<Harness />));
      let first!: Promise<boolean>; let second!: Promise<boolean>;
      await act(async () => {
        first = requestConsent("send_sms", { to: "first" });
        second = requestConsent("send_sms", { to: "second" });
      });
      expect(host.textContent).toContain("first");
      await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
      await act(async () => host.querySelector<HTMLButtonElement>("button.primary")!.click());
      await expect(first).resolves.toBe(true);
      expect(host.textContent).toContain("second");
      expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
      await act(async () => host.querySelector<HTMLButtonElement>("button:not(.primary)")!.click());
      await expect(second).resolves.toBe(false);
      expect(host.querySelector(".sheet")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove(); store.setSettings({ voiceConfirm: oldVoiceConfirm });
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
