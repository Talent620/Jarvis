import { useMemo } from "react";
import type { Lead, SentMail } from "../types";
import { computeCockpit, formatZl, winRatePct } from "../lib/salesCockpit";

// 📊 Kokpit sprzedaży — pasek KPI na górze Sprzedaży: zdrowie firmy na jeden rzut oka.
// Cienki: cała matematyka w salesCockpit (pure). Kafelki „zaległe" i „dziś" są klikalne
// (→ Plan dnia). Puste pola pozostają uczciwe (win-rate „—" bez rozstrzygnięć).
export default function SalesCockpit({ leads, sentMail, onOpenPlan }: {
  leads: Lead[];
  sentMail: SentMail[];
  onOpenPlan?: () => void;
}) {
  const c = useMemo(() => computeCockpit(leads, sentMail), [leads, sentMail]);
  const tile = (value: string, label: string, color: string, opts?: { onClick?: () => void; alert?: boolean }) => (
    <div
      className="journal-card"
      style={{
        flex: "1 1 90px", margin: 0, textAlign: "center", padding: "8px 6px",
        cursor: opts?.onClick ? "pointer" : "default",
        borderColor: opts?.alert && value !== "0" ? "var(--gold)" : undefined,
      }}
      onClick={opts?.onClick}
      role={opts?.onClick ? "button" : undefined}
    >
      <div style={{ fontSize: 19, fontFamily: "Orbitron", color }}>{value}</div>
      <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
      {tile(formatZl(c.pipeline), "💰 lejek", "var(--gold)")}
      {tile(formatZl(c.expected), "🎯 prognoza", "var(--cyan, #6ce7ff)")}
      {tile(formatZl(c.won), `🏆 wygrane (${c.wonCount})`, "var(--ok, #58e08a)")}
      {tile(winRatePct(c.winRate), "📈 skuteczność", "var(--ok, #58e08a)")}
      {tile(String(c.overdue), "⚠ zaległe", c.overdue > 0 ? "#ff6b6b" : "var(--text-dim)", { onClick: onOpenPlan, alert: true })}
      {tile(String(c.todayActions), "✅ na dziś", "var(--cyan, #6ce7ff)", { onClick: onOpenPlan })}
    </div>
  );
}
