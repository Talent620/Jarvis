// === Spokojny ekran główny (homeViewModel) — testy ===
// Najwyżej JEDNA karta „Teraz" wg priorytetu: krytyczny błąd → zgoda → zadanie dnia → decyzja → sugestia.
import { describe, it, expect } from "vitest";
import { pickNowCard, isNowCard, NOW_PRIORITY } from "../src/lib/homeViewModel";

describe("homeViewModel — priorytet karty Teraz", () => {
  it("pusty stan → brak karty (sam czat)", () => {
    expect(pickNowCard({})).toBeNull();
  });

  it("kolejność priorytetu: błąd > zgoda > zadanie > decyzja > sugestia", () => {
    expect(pickNowCard({ criticalError: true, consent: true, suggestion: true })).toBe("critical_error");
    expect(pickNowCard({ consent: true, decision: true, suggestion: true })).toBe("consent");
    expect(pickNowCard({ dailyTask: true, decision: true, suggestion: true })).toBe("daily_task");
    expect(pickNowCard({ decision: true, suggestion: true })).toBe("decision");
    expect(pickNowCard({ suggestion: true })).toBe("suggestion");
  });

  it("isNowCard pokazuje TYLKO zwycięzcę (nigdy dwóch naraz)", () => {
    const s = { decision: true, suggestion: true };
    expect(isNowCard(s, "decision")).toBe(true);
    expect(isNowCard(s, "suggestion")).toBe(false); // sugestia ustępuje decyzji
  });

  it("NOW_PRIORITY zawiera pięć rodzajów w właściwej kolejności", () => {
    expect(NOW_PRIORITY).toEqual(["critical_error", "consent", "daily_task", "decision", "suggestion"]);
  });
});
