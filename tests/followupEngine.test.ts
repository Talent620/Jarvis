import { describe, it, expect } from "vitest";
import { reduceEvents, nextFollowUp, decideFollowUp, type FollowEvent } from "../src/lib/sales/followupEngine";

const DAY = 86_400_000;
const T0 = new Date("2026-06-01T10:00:00").getTime();

describe("reduceEvents", () => {
  it("składa zdarzenia w stan", () => {
    const ev: FollowEvent[] = [
      { type: "sent", at: T0 },
      { type: "delivered", at: T0 + 1000 },
      { type: "opened", at: T0 + 2000 },
      { type: "opened", at: T0 + 3000 },
      { type: "clicked", at: T0 + 4000 },
    ];
    const st = reduceEvents(ev, 1);
    expect(st.sentAt).toBe(T0);
    expect(st.delivered).toBe(true);
    expect(st.opens).toBe(2);
    expect(st.clicks).toBe(1);
    expect(st.lastEventAt).toBe(T0 + 4000);
    expect(st.followUpsSent).toBe(1);
  });
  it("odporne na śmieci", () => {
    const st = reduceEvents([{ type: "opened" } as unknown as FollowEvent], 0);
    expect(st.opens).toBe(0); // brak `at` → pominięte
  });
});

describe("nextFollowUp — maszyna stanów", () => {
  it("nic nie wysłano → send_initial", () => {
    expect(nextFollowUp(reduceEvents([], 0), T0).action).toBe("send_initial");
  });
  it("odbicie → blacklist (priorytet)", () => {
    const ev: FollowEvent[] = [{ type: "sent", at: T0 }, { type: "opened", at: T0 }, { type: "bounced", at: T0 }];
    expect(nextFollowUp(reduceEvents(ev, 0), T0 + 10 * DAY).action).toBe("blacklist");
  });
  it("wypisał się → stop", () => {
    const ev: FollowEvent[] = [{ type: "sent", at: T0 }, { type: "unsubscribed", at: T0 }];
    expect(nextFollowUp(reduceEvents(ev, 0), T0 + 10 * DAY).action).toBe("stop");
  });
  it("odpowiedział → stop", () => {
    const ev: FollowEvent[] = [{ type: "sent", at: T0 }, { type: "replied", at: T0 }];
    expect(nextFollowUp(reduceEvents(ev, 0), T0 + 10 * DAY).action).toBe("stop");
  });
  it("otworzył + minął odstęp → follow_up_a", () => {
    const ev: FollowEvent[] = [{ type: "sent", at: T0 }, { type: "opened", at: T0 }];
    expect(nextFollowUp(reduceEvents(ev, 0), T0 + 3 * DAY).action).toBe("follow_up_a");
  });
  it("otworzył niedawno → wait", () => {
    const ev: FollowEvent[] = [{ type: "sent", at: T0 }, { type: "opened", at: T0 }];
    const d = nextFollowUp(reduceEvents(ev, 0), T0 + 1000);
    expect(d.action).toBe("wait");
    expect(d.waitMs).toBeGreaterThan(0);
  });
  it("kliknął + odstęp → follow_up_c (najgorętszy)", () => {
    const ev: FollowEvent[] = [{ type: "sent", at: T0 }, { type: "opened", at: T0 }, { type: "clicked", at: T0 }];
    expect(nextFollowUp(reduceEvents(ev, 0), T0 + 2 * DAY).action).toBe("follow_up_c");
  });
  it("cisza (brak otwarcia) + długi odstęp → follow_up_b", () => {
    const ev: FollowEvent[] = [{ type: "sent", at: T0 }];
    expect(nextFollowUp(reduceEvents(ev, 0), T0 + 5 * DAY).action).toBe("follow_up_b");
  });
  it("wyczerpana sekwencja → stop", () => {
    const ev: FollowEvent[] = [{ type: "sent", at: T0 }, { type: "opened", at: T0 }];
    expect(nextFollowUp(reduceEvents(ev, 3), T0 + 10 * DAY).action).toBe("stop");
  });
});

describe("decideFollowUp — skrót", () => {
  it("łączy reduce + next", () => {
    const ev: FollowEvent[] = [{ type: "sent", at: T0 }, { type: "clicked", at: T0 }];
    expect(decideFollowUp(ev, 0, T0 + 2 * DAY).action).toBe("follow_up_c");
  });
});
