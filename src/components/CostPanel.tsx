import { useEffect, useMemo, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { toast } from "../lib/toast";
import { store } from "../lib/store";
import { primaryKey } from "../lib/keys";
import { fetchOpenRouterCredits, isLowBalance, type Credits } from "../lib/openrouterBalance";
import {
  loadUsage,
  within,
  totals,
  breakdown,
  forecastMonthlyUsd,
  budgetStatus,
  clearUsage,
  parsePricingOverrides,
  type Totals,
} from "../lib/usageTelemetry";
import { getRouteLog } from "../lib/modelRouter";

const DAY = 86_400_000;
const usd = (n: number) => (n >= 0.005 ? `$${n.toFixed(2)}` : n > 0 ? "<$0.01" : "$0.00");
const num = (n: number) => n.toLocaleString("pl-PL");

// Ekran „Koszty AI" (Faza 5): telemetria zużycia per wywołanie, agregacje (dziś/7/30 dni),
// rozbicie per dostawca/model, prognoza miesięczna i budżet. Dane lokalne (localStorage).
export default function CostPanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [tick, setTick] = useState(0); // odśwież po wyczyszczeniu / zmianie budżetu
  const [budget, setBudget] = useState(String(store.settings.aiMonthlyBudgetUsd || ""));
  const [pricing, setPricing] = useState(store.settings.aiPricingOverrides || "");
  const [credits, setCredits] = useState<Credits | null>(null);

  // Saldo OpenRouter (Faza 6 — tylko odczyt, bez płatności). Pobierane, gdy jest klucz.
  useEffect(() => {
    const key = primaryKey("openrouter");
    if (key) void fetchOpenRouterCredits(key).then(setCredits);
  }, []);

  const data = useMemo(() => {
    const all = loadUsage();
    const now = Date.now();
    return {
      today: totals(within(all, now - DAY)),
      week: totals(within(all, now - 7 * DAY)),
      month: totals(within(all, now - 30 * DAY)),
      byProvider: breakdown(within(all, now - 30 * DAY), "provider"),
      byModel: breakdown(within(all, now - 30 * DAY), "model"),
      forecast: forecastMonthlyUsd(all, now),
      empty: all.length === 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const bud = budgetStatus(data.month.costUsd, store.settings.aiMonthlyBudgetUsd || 0);

  const saveBudget = () => {
    const v = Math.max(0, Number(budget) || 0);
    store.setSettings({ aiMonthlyBudgetUsd: v });
    setTick((t) => t + 1);
    toast(v > 0 ? `✅ Budżet: $${v}/mies.` : "Budżet wyłączony");
  };

  const sumRow = (label: string, t: Totals) => (
    <div className="status-row" key={label}>
      <div className="status-main">
        <div className="status-title">{label}</div>
        <div className="status-detail">
          {t.calls} wywołań · {num(t.inputTokens)} in / {num(t.outputTokens)} out tok
        </div>
      </div>
      <strong style={{ fontSize: 15 }}>{usd(t.costUsd)}</strong>
    </div>
  );

  const breakdownList = (title: string, map: Record<string, Totals>) => {
    const rows = Object.entries(map).sort((a, b) => b[1].costUsd - a[1].costUsd);
    if (!rows.length) return null;
    return (
      <>
        <h3 style={{ margin: "18px 0 6px", fontSize: 14 }}>{title}</h3>
        {rows.map(([k, t]) => (
          <div className="status-row" key={k}>
            <div className="status-main">
              <div className="status-title" style={{ wordBreak: "break-all" }}>{k}</div>
              <div className="status-detail">{t.calls} wywołań · {num(t.inputTokens + t.outputTokens)} tok</div>
            </div>
            <span>{usd(t.costUsd)}</span>
          </div>
        ))}
      </>
    );
  };

  const recent = getRouteLog().slice(0, 8);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>💸 Koszty AI</h2>
        </div>
        <div className="panel-body">
          {credits && (
            <div
              className="status-row"
              style={{
                border: isLowBalance(credits.remaining, store.settings.openrouterLowBalanceUsd)
                  ? "1px solid var(--danger,#ff6b6b)"
                  : undefined,
                borderRadius: 8,
                padding: 8,
                marginBottom: 8,
              }}
            >
              <div className="status-main">
                <div className="status-title">OpenRouter — saldo</div>
                <div className="status-detail">
                  zużyto {usd(credits.usage)} z {usd(credits.total)}
                  {isLowBalance(credits.remaining, store.settings.openrouterLowBalanceUsd) ? " · ⚠ niskie saldo" : ""}
                </div>
              </div>
              <strong style={{ fontSize: 15 }}>{usd(credits.remaining)}</strong>
            </div>
          )}
          {data.empty ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Brak danych o zużyciu. Koszty pojawią się po pierwszych odpowiedziach modeli
              raportujących tokeny (Claude, Gemini, Groq i zgodne z OpenAI).
            </p>
          ) : (
            <>
              {sumRow("Dziś", data.today)}
              {sumRow("Ostatnie 7 dni", data.week)}
              {sumRow("Ostatnie 30 dni", data.month)}

              <h3 style={{ margin: "18px 0 6px", fontSize: 14 }}>Prognoza i budżet</h3>
              <div className="status-row">
                <div className="status-main">
                  <div className="status-title">Prognoza / miesiąc</div>
                  <div className="status-detail">run-rate z 7 dni × 30</div>
                </div>
                <strong>{usd(data.forecast)}</strong>
              </div>
              {store.settings.aiMonthlyBudgetUsd > 0 && (
                <div style={{ margin: "8px 0 4px" }}>
                  <div
                    style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,.1)", overflow: "hidden" }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, bud.pct * 100).toFixed(0)}%`,
                        background: bud.over ? "var(--danger,#ff6b6b)" : bud.warn ? "#f5a623" : "var(--accent,#4caf50)",
                      }}
                    />
                  </div>
                  <div className="status-detail" style={{ marginTop: 4 }}>
                    {usd(bud.spentUsd)} z ${bud.budgetUsd}/mies. ({(bud.pct * 100).toFixed(0)}%)
                    {bud.over ? " · ⛔ przekroczono" : bud.warn ? " · ⚠ blisko limitu" : ""}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, margin: "8px 0 4px", alignItems: "center" }}>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="Budżet $/mies. (0 = brak)"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn" style={{ maxWidth: 120 }} onClick={saveBudget}>Zapisz</button>
              </div>
              {credits && (
                <div style={{ display: "flex", gap: 8, margin: "4px 0", alignItems: "center" }}>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="Alert salda OpenRouter $ (0 = off)"
                    defaultValue={store.settings.openrouterLowBalanceUsd || ""}
                    onChange={(e) => store.setSettings({ openrouterLowBalanceUsd: Math.max(0, Number(e.target.value) || 0) })}
                    style={{ flex: 1 }}
                  />
                </div>
              )}

              <details style={{ marginTop: 6 }}>
                <summary className="status-detail" style={{ cursor: "pointer" }}>Cennik (nadpisz, JSON)</summary>
                <textarea
                  className="input"
                  rows={3}
                  spellCheck={false}
                  placeholder={'{"claude-opus-4-8":{"in":15,"out":75}}'}
                  value={pricing}
                  onChange={(e) => setPricing(e.target.value)}
                  style={{ width: "100%", marginTop: 6, fontFamily: "monospace", fontSize: 12 }}
                />
                <button
                  className="btn"
                  style={{ marginTop: 6, maxWidth: 160 }}
                  onClick={() => {
                    const t = pricing.trim();
                    if (t && parsePricingOverrides(t) === undefined) {
                      toast("⚠ Niepoprawny JSON cennika — nie zapisano.");
                      return;
                    }
                    store.setSettings({ aiPricingOverrides: t });
                    setTick((x) => x + 1);
                    toast("✅ Cennik zapisany (działa od kolejnych wywołań).");
                  }}
                >
                  Zapisz cennik
                </button>
              </details>

              {breakdownList("Wg dostawcy (30 dni)", data.byProvider)}
              {breakdownList("Wg modelu (30 dni)", data.byModel)}

              {recent.length > 0 && (
                <>
                  <h3 style={{ margin: "18px 0 6px", fontSize: 14 }}>Ostatnie decyzje routera</h3>
                  {recent.map((r, i) => (
                    <div className="status-detail" key={i} style={{ padding: "2px 0", wordBreak: "break-all" }}>
                      {r.fellBack ? "↪ " : ""}{r.provider}/{r.model} · {r.kind} — {r.reason}
                    </div>
                  ))}
                </>
              )}

              <button
                className="btn"
                style={{ marginTop: 18 }}
                onClick={() => {
                  if (confirm("Wyczyścić historię kosztów? (nieodwracalne)")) {
                    clearUsage();
                    setTick((t) => t + 1);
                    toast("Wyczyszczono historię kosztów.");
                  }
                }}
              >
                🗑 Wyczyść historię kosztów
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
