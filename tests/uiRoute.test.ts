// === Jedna nawigacja (uiRoute) — testy ===
// Najwyżej JEDEN zwykły ekran naraz; otwarcie zamyka poprzedni; „Wstecz" wraca z kontekstem; kontekst
// leada/projektu podróżuje w trasie (nie przez przypadkowe flagi).
import { describe, it, expect } from "vitest";
import { uiRouteReducer, initialRoute, canGoBack, isActiveScreen, type RouteState } from "../src/lib/uiRoute";

const open = (s: RouteState, screen: string, ctx?: unknown) => uiRouteReducer(s, { type: "open", screen, ctx });

describe("uiRoute — jeden aktywny ekran", () => {
  it("otwarcie ustawia ekran; kolejne otwarcie ZAMYKA poprzedni (nie nakładają się)", () => {
    let s = open(initialRoute, "sales");
    expect(s.screen).toBe("sales");
    s = open(s, "web");
    expect(s.screen).toBe("web"); // tylko jeden aktywny
    expect(isActiveScreen(s, "sales")).toBe(false);
  });

  it("ten sam ekran ponownie → tylko aktualizacja kontekstu, bez wpisu w historii", () => {
    let s = open(initialRoute, "web", { leadId: "a" });
    s = open(s, "web", { leadId: "b" });
    expect(s.screen).toBe("web");
    expect(s.ctx).toEqual({ leadId: "b" });
    expect(s.stack).toHaveLength(0);
  });
});

describe("uiRoute — Wstecz z zachowaniem kontekstu", () => {
  it("back wraca do poprzedniego ekranu i JEGO kontekstu", () => {
    let s = open(initialRoute, "sales", { tab: "clients" });
    s = open(s, "web", { leadId: "x" });
    expect(canGoBack(s)).toBe(true);
    s = uiRouteReducer(s, { type: "back" });
    expect(s.screen).toBe("sales");
    expect(s.ctx).toEqual({ tab: "clients" }); // kontekst wrócił
    expect(canGoBack(s)).toBe(false);
  });

  it("back bez historii → ekran główny (null)", () => {
    const s = uiRouteReducer(open(initialRoute, "sales"), { type: "back" });
    expect(s.screen).toBeNull();
  });
});

describe("uiRoute — closeIf (bezpieczny setShowX(false))", () => {
  it("closeIf zamyka TYLKO gdy ten ekran jest aktywny; inaczej no-op", () => {
    const s = open(initialRoute, "sales");
    // Zamknięcie innego ekranu nie rusza aktywnego (żaden „setShowX(false)" nie zamyka cudzego okna).
    expect(uiRouteReducer(s, { type: "closeIf", screen: "web" })).toBe(s);
    expect(uiRouteReducer(s, { type: "closeIf", screen: "sales" }).screen).toBeNull();
  });
});

describe("uiRoute — close/reset i kontekst trasy", () => {
  it("close czyści ekran i historię", () => {
    let s = open(open(initialRoute, "a"), "b");
    s = uiRouteReducer(s, { type: "close" });
    expect(s.screen).toBeNull();
    expect(s.stack).toHaveLength(0);
  });

  it("kontekst leada podróżuje z trasą (nie przez osobne flagi)", () => {
    const s = open(initialRoute, "web", { leadId: "L1", company: "Alfa" });
    expect(s.ctx).toEqual({ leadId: "L1", company: "Alfa" });
  });

  it("historia nie rośnie w nieskończoność (limit)", () => {
    let s = initialRoute;
    for (let i = 0; i < 50; i++) s = open(s, `screen-${i}`);
    expect(s.stack.length).toBeLessThanOrEqual(20);
  });
});
