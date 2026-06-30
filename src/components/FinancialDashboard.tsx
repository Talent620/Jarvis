import { useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { useStore } from "../hooks/useStore";
import { store } from "../lib/store";
import { toast } from "../lib/toast";
import { financeKpis, monthlyRevenue, clientRanking, FINANCE_STATUSES, applyPayment, removeProjectById, restoreProject } from "../lib/finance";
import type { FinanceProject, FinanceStatus } from "../types";

// 💰 Financial Intelligence — natywny moduł Jarvisa. Dashboard KPI + projekty + dodawanie.
// Dane w store (kolekcja financeProjects). Liczenie w pure finance.ts. To fundament — Kanban,
// wykresy, głos i eksport dochodzą w kolejnych iteracjach.
const zl = (n: number) => `${Math.round(n).toLocaleString("pl-PL")} zł`;
const uid = () => `fp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function FinancialDashboard({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const projects = data.financeProjects || [];
  const k = financeKpis(projects);
  const months = monthlyRevenue(projects, Date.now(), 6);
  const ranking = clientRanking(projects, 5);
  const maxMonth = Math.max(1, ...months.map((m) => m.revenue));

  const [form, setForm] = useState({ name: "", client: "", amount: "", cost: "", status: "lead" as FinanceStatus });
  const add = () => {
    if (!form.name.trim()) { toast("Podaj nazwę projektu."); return; }
    const now = Date.now();
    const p: FinanceProject = {
      id: uid(), name: form.name.trim(), client: form.client.trim() || undefined, status: form.status,
      amount: Number(form.amount) || 0, cost: Number(form.cost) || undefined, createdAt: now, updatedAt: now,
    };
    store.setData((d) => { if (!d.financeProjects) d.financeProjects = []; d.financeProjects.unshift(p); });
    setForm({ name: "", client: "", amount: "", cost: "", status: "lead" });
    toast(`💰 Dodano projekt: ${p.name}`);
  };
  const setStatus = (id: string, status: FinanceStatus) => {
    // „Opłacone" NIE ustawia po cichu pełnej wpłaty — pytamy o realnie wpłaconą kwotę (domyślnie reszta do zapłaty).
    if (status === "oplacone") {
      const p = (store.data.financeProjects || []).find((x) => x.id === id);
      if (!p) return;
      const due = Math.max(0, (Number(p.amount) || 0) - (Number(p.paidAmount) || 0));
      const ans = window.prompt(`Ile realnie wpłacono na „${p.name}"? (zł)\nDo zapłaty pozostało: ${zl(due)}`, String(due));
      if (ans === null) return; // anulowano — status bez zmian
      const amount = Number(ans.replace(",", "."));
      store.setData((d) => {
        const idx = (d.financeProjects || []).findIndex((x) => x.id === id);
        if (idx >= 0) d.financeProjects![idx] = applyPayment(d.financeProjects![idx], { amount, method: "ręczna" }, Date.now());
      });
      const p2 = (store.data.financeProjects || []).find((x) => x.id === id);
      toast(p2?.status === "oplacone" ? "✅ Zapisano pełną wpłatę." : "💸 Zapisano częściową wpłatę.");
      return;
    }
    store.setData((d) => { const p = (d.financeProjects || []).find((x) => x.id === id); if (p) { p.status = status; p.updatedAt = Date.now(); } });
  };
  const remove = (id: string) => {
    let removed: ReturnType<typeof removeProjectById>["removed"] = null;
    let index = -1;
    store.setData((d) => {
      const r = removeProjectById(d.financeProjects || [], id);
      d.financeProjects = r.next; removed = r.removed; index = r.index;
    });
    if (removed) {
      toast("🗑 Usunięto projekt", { label: "Cofnij", onClick: () => {
        store.setData((d) => { d.financeProjects = restoreProject(d.financeProjects || [], removed!, index); });
        toast("↩ Przywrócono projekt");
      } });
    }
  };

  const KPI = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div style={{ flex: "1 1 120px", minWidth: 120, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", background: "linear-gradient(135deg, rgba(108,231,255,.05), transparent 70%)" }}>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || "var(--text)", marginTop: 2 }}>{value}</div>
    </div>
  );

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><div className="grabber" /><h2>💰 Financial Intelligence</h2></div>
        <div className="panel-body">
          {/* KPI */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <KPI label="Przychód" value={zl(k.revenue)} color="var(--cyan)" />
            <KPI label="Lejek (prognoza)" value={zl(k.pipelineValue)} color="var(--gold)" />
            <KPI label="Zysk" value={zl(k.profit)} color={k.profit >= 0 ? "#39d98a" : "#ff6b6b"} />
            <KPI label="Marża" value={`${k.margin}%`} />
            <KPI label="ROI" value={`${k.roi}%`} />
            <KPI label="Koszty" value={zl(k.costs)} />
            <KPI label="VAT (23%/proj.)" value={zl(k.vat)} />
            <KPI label="Zapłacone" value={zl(k.paid)} color="#39d98a" />
            <KPI label="Do zapłaty" value={zl(k.unpaid)} color={k.unpaid > 0 ? "var(--gold)" : undefined} />
            <KPI label="Klienci" value={String(k.clients)} />
            <KPI label="Aktywne" value={String(k.openCount)} />
            <KPI label="Śr. wartość" value={zl(k.avgValue)} />
            <KPI label="Stawka/h" value={k.effectiveHourlyRate ? zl(k.effectiveHourlyRate) : "—"} />
          </div>
          {(k.topClient || k.bestProject) && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {k.topClient && <>🏆 Najlepszy klient: <b>{k.topClient.name}</b> ({zl(k.topClient.revenue)}). </>}
              {k.bestProject && <>💎 Najdochodowszy projekt: <b>{k.bestProject.name}</b> ({zl(k.bestProject.profit)}).</>}
            </p>
          )}

          {/* Trend miesięczny (mini-wykres słupkowy) */}
          <div style={{ marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>📈 Przychód (6 mies.)</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70 }}>
              {months.map((m) => (
                <div key={m.label} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: `${Math.round((m.revenue / maxMonth) * 56)}px`, background: "var(--cyan)", borderRadius: "4px 4px 0 0", opacity: m.revenue ? 0.9 : 0.25, transition: "height .4s" }} />
                  <div className="muted" style={{ fontSize: 9, marginTop: 3 }}>{m.label.slice(0, 5)}</div>
                </div>
              ))}
            </div>
          </div>

          {ranking.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>👥 Ranking klientów</div>
              {ranking.map((r, i) => (
                <div key={r.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}>
                  <span>{i + 1}. {r.name} <span className="muted">({r.projects})</span></span>
                  <b>{zl(r.revenue)}</b>
                </div>
              ))}
            </div>
          )}

          {/* Dodaj projekt */}
          <div className="journal-card" style={{ marginTop: 14, padding: "10px 12px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>➕ Nowy projekt</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input value={form.name} placeholder="Nazwa projektu" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input value={form.client} placeholder="Klient (opcjonalnie)" onChange={(e) => setForm({ ...form, client: e.target.value })} />
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" value={form.amount} placeholder="Kwota netto zł" onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ flex: 1 }} />
                <input type="number" value={form.cost} placeholder="Koszt zł" onChange={(e) => setForm({ ...form, cost: e.target.value })} style={{ flex: 1 }} />
              </div>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FinanceStatus })}>
                {FINANCE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <button className="btn primary" onClick={add}>💾 Dodaj projekt</button>
            </div>
          </div>

          {/* Lista projektów */}
          {projects.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>📋 Projekty ({projects.length})</div>
              {projects.map((p) => (
                <div key={p.id} className="journal-card" style={{ padding: "8px 10px", marginTop: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{p.client || "—"} · {zl(p.amount)}{p.cost ? ` · koszt ${zl(p.cost)}` : ""}</div>
                    </div>
                    <button className="chip" onClick={() => remove(p.id)} title="Usuń">✕</button>
                  </div>
                  <select value={p.status} onChange={(e) => setStatus(p.id, e.target.value as FinanceStatus)} style={{ marginTop: 6, fontSize: 12 }}>
                    {FINANCE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Brak projektów. Dodaj pierwszy — KPI policzą się same.</p>
          )}
        </div>
        <div className="panel-foot"><button className="btn" onClick={onClose}>Zamknij</button></div>
      </div>
    </div>
  );
}
