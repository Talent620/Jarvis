import { describe, it, expect } from "vitest";
import { assessPhoneRisk, formatUiTree, parseUiTree, verifyCheckThenAct } from "../src/lib/phoneAgent";
import { isClassified, riskOf } from "../src/lib/permissions";

describe("Android Phone Use — parser i formatter drzewa UI", () => {
  it("parsuje skompresowane linie [id] Role \"Label\" (x,y) i oznacza [PASSWORD_BLOCKED]", () => {
    const raw = [
      `[1] Button "Szukaj" (540,180)`,
      `[2] Input "[PASSWORD_BLOCKED]" (420,900)`,
      `[3] Link "Wyślij wiadomość" (880,1920)`,
      `niepoprawna linia nagłówka`,
    ].join("\n");

    const parsed = parseUiTree(raw);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ id: 1, role: "Button", label: "Szukaj", x: 540, y: 180 });
    expect(parsed[1]).toEqual({ id: 2, role: "Input", label: "[PASSWORD_BLOCKED]", x: 420, y: 900, isPassword: true });
    expect(parsed[2]).toEqual({ id: 3, role: "Link", label: "Wyślij wiadomość", x: 880, y: 1920 });
  });

  it("formatUiTree twardo redaguje pola isPassword i oczyszcza cudzysłowy", () => {
    const out = formatUiTree([
      { id: 1, role: "Input", label: "tajneHaslo123", x: 100.4, y: 200.6, isPassword: true },
      { id: 2, role: "Button", label: 'Otwórz "Ustawienia"\nnowe', x: 50, y: 60 },
    ]);
    expect(out).not.toContain("tajneHaslo123");
    expect(out).toContain('[1] Input "[PASSWORD_BLOCKED]" (100,201)');
    expect(out).toContain("[2] Button \"Otwórz 'Ustawienia' nowe\" (50,60)");
  });
});

describe("RiskGuard — kategoryzacja ryzyka i blokada haseł", () => {
  it("całkowicie blokuje pola haseł (isPassword=true lub [PASSWORD_BLOCKED])", () => {
    const a = assessPhoneRisk({ action: "type", label: "Hasło", isPassword: true });
    expect(a.blocked).toBe(true);
    expect(a.category).toBe("security");

    const b = assessPhoneRisk({ action: "tapById", label: "[PASSWORD_BLOCKED]" });
    expect(b.blocked).toBe(true);
  });

  it("klasyfikuje money, security, delete, send jako wymagające potwierdzenia", () => {
    expect(assessPhoneRisk({ label: "Zapłać BLIK 120 zł" })).toMatchObject({ blocked: false, requiresConfirmation: true, category: "money" });
    expect(assessPhoneRisk({ label: "Wykonaj przelew", packageName: "pl.mbank" })).toMatchObject({ requiresConfirmation: true, category: "money" });
    expect(assessPhoneRisk({ label: "Odinstaluj aplikację" })).toMatchObject({ requiresConfirmation: true, category: "security" });
    expect(assessPhoneRisk({ label: "Usuń wszystkie wiadomości" })).toMatchObject({ requiresConfirmation: true, category: "delete" });
    expect(assessPhoneRisk({ label: "Wyślij e-mail" })).toMatchObject({ requiresConfirmation: true, category: "send" });
  });

  it("przepuszcza neutralną nawigację bez flagi ryzyka", () => {
    const r = assessPhoneRisk({ label: "Prognoza pogody na jutro", packageName: "com.android.chrome" });
    expect(r.blocked).toBe(false);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.category).toBeNull();
  });
});

describe("Check-then-Act — weryfikacja ekranu przed akcją", () => {
  const live = {
    signature: "com.whatsapp#2#abcd",
    elements: [
      { id: 1, role: "Button", label: "Szukaj", x: 100, y: 100 },
      { id: 2, role: "Input", label: "[PASSWORD_BLOCKED]", x: 100, y: 200, isPassword: true },
    ],
  };

  it("przerywa, gdy sygnatura ekranu się zmieniła", () => {
    const res = verifyCheckThenAct({ id: 1, signature: "com.whatsapp#2#OLD", label: "Szukaj" }, live);
    expect(res.ok).toBe(false);
    expect(res.aborted).toBe(true);
  });

  it("przerywa, gdy etykieta elementu się zmieniła", () => {
    const res = verifyCheckThenAct({ id: 1, signature: live.signature, label: "Anuluj" }, live);
    expect(res.ok).toBe(false);
    expect(res.aborted).toBe(true);
  });

  it("blokuje pole hasła nawet przy zgodnej sygnaturze", () => {
    const res = verifyCheckThenAct({ id: 2, signature: live.signature }, live);
    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
  });

  it("zatwierdza poprawny cel przy zgodnej sygnaturze i etykiecie", () => {
    const res = verifyCheckThenAct({ id: 1, signature: live.signature, label: "szukaj" }, live);
    expect(res.ok).toBe(true);
    expect(res.element?.id).toBe(1);
  });
});

describe("klasyfikacja uprawnień narzędzi Phone Use", () => {
  it("wszystkie nowe narzędzia android_* są jawnie sklasyfikowane w permissions.ts", () => {
    expect(isClassified("android_ui_tree")).toBe(true);
    expect(riskOf("android_ui_tree")).toBe("read");
    for (const t of ["android_tap_id", "android_scroll", "android_back", "android_type", "android_open_app"]) {
      expect(isClassified(t)).toBe(true);
      expect(riskOf(t)).toBe("outbound");
    }
  });
});
