import { describe, it, expect } from "vitest";
import {
  campaignFooter,
  footerValid,
  withComplianceFooter,
  isWithinWorkingHours,
  campaignExpired,
  campaignCanSendNow,
  nextThrottleMs,
  applySuccess,
  applyFailure,
  classifyFailure,
  newCampaign,
  campaignStatusText,
  DEFAULT_WORKING_HOURS,
  DEFAULT_DAILY_LIMIT,
  DEFAULT_TOTAL_CAP,
  FAIL_STREAK_LIMIT,
} from "../src/lib/offerCampaign";
import type { OfferCampaign } from "../src/types";

// Silnik auto-kampanii to warstwa BEZPIECZEŃSTWA — testy są adwersarskie: próbują
// „przemycić" wysyłkę mimo limitu/okna/stopki/bezpiecznika. Każda taka próba MUSI zostać zablokowana.

const NOW = 1_700_000_000_000;
const validFooter = campaignFooter("— Marcin Kubicki");

// Domyślnie okno „zawsze otwarte" (wszystkie dni/godziny), żeby testy limitów/throttlingu były
// niezależne od strefy czasowej CI. Test okna roboczego jawnie używa DEFAULT_WORKING_HOURS.
function mk(over: Partial<OfferCampaign> = {}): OfferCampaign {
  return {
    active: true,
    dailyLimit: DEFAULT_DAILY_LIMIT,
    throttleMs: 90_000,
    totalCap: DEFAULT_TOTAL_CAP,
    sentTotal: 0,
    lastSentAt: 0,
    startedAt: NOW,
    expiresAt: NOW + 7 * 24 * 3600_000,
    failStreak: 0,
    workingHours: { startHour: 0, endHour: 24, days: [0, 1, 2, 3, 4, 5, 6] },
    ...over,
  };
}
const ctx = (over: Partial<{ sentToday: number; footer: string; now: number }> = {}) => ({
  sentToday: 0,
  footer: validFooter,
  now: NOW,
  ...over,
});

describe("stopka zgodności (RODO/PKE)", () => {
  it("zawiera opt-out „STOP”, podstawę RODO i tożsamość administratora", () => {
    expect(validFooter).toMatch(/STOP/);
    expect(validFooter).toMatch(/RODO/);
    expect(validFooter.toLowerCase()).toContain("administrator");
    expect(footerValid(validFooter)).toBe(true);
  });
  it("pusta / kadłubowa stopka jest NIEważna (blokuje wysyłkę)", () => {
    expect(footerValid("")).toBe(false);
    expect(footerValid("Pozdrawiam")).toBe(false);
    expect(footerValid("Marcin Kubicki")).toBe(false); // brak opt-out
    expect(footerValid("Napisz STOP aby się wypisać")).toBe(false); // brak tożsamości
  });
  it("stopka działa też bez podpisu użytkownika (domyślna wciąż zgodna)", () => {
    expect(footerValid(campaignFooter())).toBe(true);
  });
  it("withComplianceFooter dokleja stopkę, ale nie dubluje, gdy już zgodna", () => {
    const once = withComplianceFooter("Treść oferty.", validFooter);
    expect(footerValid(once)).toBe(true);
    const twice = withComplianceFooter(once, validFooter);
    expect(twice).toBe(once); // idempotentne — brak drugiej stopki
  });
});

describe("bramka wysyłki — twarde bezpieczniki", () => {
  it("przepuszcza, gdy WSZYSTKO ok", () => {
    expect(campaignCanSendNow(mk(), ctx()).ok).toBe(true);
  });
  it("blokuje nieuzbrojoną kampanię", () => {
    expect(campaignCanSendNow(mk({ active: false }), ctx()).ok).toBe(false);
  });
  it("blokuje wygasłą kampanię", () => {
    expect(campaignCanSendNow(mk({ expiresAt: NOW - 1 }), ctx()).ok).toBe(false);
  });
  it("blokuje kampanię wstrzymaną (bezpiecznik)", () => {
    expect(campaignCanSendNow(mk({ pausedReason: "błąd" }), ctx()).ok).toBe(false);
  });
  it("KRYTYCZNE: blokuje wysyłkę bez zgodnej stopki (opt-out/RODO)", () => {
    const g = campaignCanSendNow(mk(), ctx({ footer: "Pozdrawiam" }));
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/stopk/i);
  });
  it("blokuje po osiągnięciu limitu kampanii", () => {
    expect(campaignCanSendNow(mk({ sentTotal: 200, totalCap: 200 }), ctx()).ok).toBe(false);
  });
  it("blokuje po osiągnięciu dziennego limitu (liczy też ręczne)", () => {
    expect(campaignCanSendNow(mk({ dailyLimit: 20 }), ctx({ sentToday: 20 })).ok).toBe(false);
  });
  it("blokuje w throttlingu (za wcześnie po ostatniej wysyłce)", () => {
    const g = campaignCanSendNow(mk({ lastSentAt: NOW - 10_000, throttleMs: 90_000 }), ctx());
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/throttl/i);
  });
  it("przepuszcza, gdy throttling minął", () => {
    expect(campaignCanSendNow(mk({ lastSentAt: NOW - 100_000, throttleMs: 90_000 }), ctx()).ok).toBe(true);
  });
});

describe("okno robocze (8–18, pn–pt)", () => {
  it("środa 10:00 (lokalnie) mieści się w oknie", () => {
    const wed = new Date(2026, 0, 7, 10, 0, 0); // Jan 7 2026 = środa
    expect(wed.getDay()).toBe(3);
    expect(isWithinWorkingHours(wed.getTime(), DEFAULT_WORKING_HOURS)).toBe(true);
  });
  it("niedziela jest poza oknem", () => {
    const sun = new Date(2026, 0, 4, 10, 0, 0); // Jan 4 2026 = niedziela
    expect(sun.getDay()).toBe(0);
    expect(isWithinWorkingHours(sun.getTime(), DEFAULT_WORKING_HOURS)).toBe(false);
  });
  it("20:00 w dzień roboczy jest poza oknem", () => {
    const wedNight = new Date(2026, 0, 7, 20, 0, 0);
    expect(isWithinWorkingHours(wedNight.getTime(), DEFAULT_WORKING_HOURS)).toBe(false);
  });
  it("bramka blokuje poza oknem mimo reszty OK", () => {
    const sun = new Date(2026, 0, 4, 10, 0, 0).getTime();
    const g = campaignCanSendNow(mk({ workingHours: DEFAULT_WORKING_HOURS, expiresAt: sun + 3600_000 }), ctx({ now: sun }));
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/okn/i);
  });
});

describe("licznik i auto-wyłączenie", () => {
  it("applySuccess: +1, reset serii błędów, znacznik czasu", () => {
    const c = applySuccess(mk({ sentTotal: 3, failStreak: 2 }), NOW);
    expect(c.sentTotal).toBe(4);
    expect(c.failStreak).toBe(0);
    expect(c.lastSentAt).toBe(NOW);
    expect(c.active).toBe(true);
  });
  it("applySuccess przy ostatnim mailu WYŁĄCZA kampanię (osiągnięto cap)", () => {
    const c = applySuccess(mk({ sentTotal: 199, totalCap: 200 }), NOW);
    expect(c.sentTotal).toBe(200);
    expect(c.active).toBe(false);
    expect(c.pausedReason).toMatch(/limit/i);
  });
});

describe("bezpiecznik (circuit breaker)", () => {
  it("seria przejściowych błędów wstrzymuje dopiero po progu", () => {
    let c = mk();
    for (let i = 0; i < FAIL_STREAK_LIMIT - 1; i++) c = applyFailure(c, "transient", NOW);
    expect(c.pausedReason).toBeUndefined(); // jeszcze działa
    c = applyFailure(c, "transient", NOW);
    expect(c.failStreak).toBe(FAIL_STREAK_LIMIT);
    expect(c.pausedReason).toBeTruthy(); // próg → wstrzymanie
  });
  it("błąd auth wstrzymuje NATYCHMIAST (nie czeka na serię)", () => {
    const c = applyFailure(mk(), "auth", NOW);
    expect(c.pausedReason).toMatch(/logowani/i);
  });
  it("błąd limit/reputacja wstrzymuje NATYCHMIAST", () => {
    const c = applyFailure(mk(), "limit", NOW);
    expect(c.pausedReason).toMatch(/limit|reputacj/i);
  });
  it("classifyFailure rozpoznaje rodzaje po komunikacie dostawcy", () => {
    expect(classifyFailure("535 auth failed / hasło")).toBe("auth");
    expect(classifyFailure("Połącz konto Google")).toBe("auth");
    expect(classifyFailure("rate limit exceeded (too many)")).toBe("limit");
    expect(classifyFailure("timeout sieci")).toBe("transient");
  });
});

describe("throttling z rozrzutem i uzbrajanie", () => {
  it("nextThrottleMs mieści się w [base-jitter, base+jitter) i nie schodzi < 0", () => {
    expect(nextThrottleMs(90_000, 30_000, 0)).toBe(60_000); // rnd=0 → -jitter
    expect(nextThrottleMs(90_000, 30_000, 0.5)).toBe(90_000); // środek
    expect(nextThrottleMs(90_000, 30_000, 0.999)).toBeGreaterThanOrEqual(90_000);
    expect(nextThrottleMs(5_000, 30_000, 0)).toBe(0); // nigdy ujemne
  });
  it("newCampaign klamruje dzienny limit i cap do bezpiecznych zakresów", () => {
    expect(newCampaign(NOW, { dailyLimit: 99999 }).dailyLimit).toBe(200);
    expect(newCampaign(NOW, { dailyLimit: 0 }).dailyLimit).toBe(1);
    expect(newCampaign(NOW).dailyLimit).toBe(DEFAULT_DAILY_LIMIT);
    expect(newCampaign(NOW).active).toBe(true);
    expect(newCampaign(NOW).expiresAt).toBeGreaterThan(NOW);
  });
  it("kampania wygasa po TTL", () => {
    const c = newCampaign(NOW, { ttlMs: 1000 });
    expect(campaignExpired(c, NOW + 999)).toBe(false);
    expect(campaignExpired(c, NOW + 1000)).toBe(true);
  });
});

describe("status dla człowieka (uczciwy, bez udawania sukcesu)", () => {
  it("nieuzbrojona / aktywna / wstrzymana mają czytelne opisy", () => {
    expect(campaignStatusText(undefined, 0, NOW)).toMatch(/nieuzbroj/i);
    expect(campaignStatusText(mk(), 3, NOW)).toMatch(/AKTYWNA/);
    expect(campaignStatusText(mk({ pausedReason: "błąd logowania" }), 3, NOW)).toMatch(/WSTRZYMANA/);
    expect(campaignStatusText(mk({ active: false }), 0, NOW)).toMatch(/wyłączona/i);
  });
});
