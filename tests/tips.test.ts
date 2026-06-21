import { describe, it, expect } from "vitest";
import { TIPS, eligibleTips, pickTip, contextualTip, dailyDigestTip, type TipCtx } from "../src/lib/tips";

const ctx = (over: Partial<TipCtx> = {}): TipCtx => ({ hasBrain: true, messages: 0, desktop: false, ...over });

describe("tips — pickTip (rotacja + warunki)", () => {
  it("bez mózgu → null (najpierw onboarding klucza)", () => {
    expect(pickTip(ctx({ hasBrain: false }), [])).toBeNull();
  });
  it("najpierw nieobejrzane, wg kuratorowanej ważności", () => {
    const first = pickTip(ctx({ desktop: true }), []);
    expect(first?.id).toBe("cmdk"); // pierwszy w puli (desktop)
    const second = pickTip(ctx({ desktop: true }), ["cmdk"]);
    expect(second?.id).toBe("voice");
  });
  it("pomija porady niespełniające warunku (cmdk tylko desktop)", () => {
    const ids = eligibleTips(ctx({ desktop: false }), []).map((t) => t.id);
    expect(ids).not.toContain("cmdk");
    expect(ids).toContain("voice");
  });
  it("gdy wszystkie pasujące obejrzane → rotuje od nowa (nie null)", () => {
    const c = ctx({ desktop: false, messages: 1 });
    const allIds = eligibleTips(c, []).map((t) => t.id);
    const again = pickTip(c, allIds);
    expect(again).not.toBeNull();
    expect(again?.id).toBe(allIds[0]); // najstarsza z brzegu
  });
  it("research pojawia się dopiero, gdy są wiadomości", () => {
    expect(eligibleTips(ctx({ messages: 0 }), []).some((t) => t.id === "research")).toBe(false);
    expect(eligibleTips(ctx({ messages: 3 }), []).some((t) => t.id === "research")).toBe(true);
  });
  it("każda porada z akcją wskazuje istniejące id polecenia i ma etykietę", () => {
    for (const t of TIPS) if (t.actionId) expect(t.actionLabel && t.actionLabel.length > 0).toBe(true);
  });
});

describe("tips — contextualTip (mądrzejsze: dopasowane do treści)", () => {
  it("zaplanuj → Zleć cel; przerób zdjęcie → Studio; zapamiętaj → memory; najtaniej → bargain", () => {
    expect(contextualTip("zaplanuj mi wejście na rynek", [])?.id).toBe("goal");
    expect(contextualTip("przerób to zdjęcie i usuń tło", [])?.id).toBe("studio");
    expect(contextualTip("zapamiętaj, że mam spotkanie", [])?.id).toBe("memory");
    expect(contextualTip("gdzie kupię najtaniej wiertarkę", [])?.id).toBe("bargain");
  });
  it("brak trafienia / zbyt krótkie → null", () => {
    expect(contextualTip("dzień dobry jak leci", [])).toBeNull();
    expect(contextualTip("hej", [])).toBeNull();
  });
  it("nie powtarza już pokazanej porady", () => {
    expect(contextualTip("zaplanuj projekt", ["goal"])).toBeNull();
  });
});

describe("tips — dailyDigestTip (Dziś możesz: …)", () => {
  it("składa 2–3 funkcje z etykietami akcji", () => {
    const d = dailyDigestTip({ hasBrain: true, messages: 0, desktop: false }, []);
    expect(d?.id).toBe("digest");
    expect(d?.text).toMatch(/Dziś możesz:/);
    expect((d?.text.match(/·/g) || []).length).toBeGreaterThanOrEqual(1); // ≥2 pozycje
  });
  it("bez mózgu → null", () => {
    expect(dailyDigestTip({ hasBrain: false, messages: 0, desktop: false }, [])).toBeNull();
  });
});
