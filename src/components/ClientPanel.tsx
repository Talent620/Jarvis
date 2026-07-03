import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import Modal from "./Modal";
import { clientRecord, PIPELINE_STAGES, addTag, removeTag, suggestedTags } from "../lib/clientRecord";
import { reminderInDays } from "../lib/clientCrm";
import { appendLeadNote } from "../lib/leadNotes";
import { mailtoUrl, smsUrl, mapsSearchUrl, safeOpenExternal } from "../lib/glinks";
import { copyWithToast, toast } from "../lib/toast";
import type { Lead, LeadStatus } from "../types";

// 🪪 Panel Klienta (CRM-first) — dedykowany, KOMPLETNY rekord klienta: kim jest, na jakim etapie
// lejka, ile wart, co się działo i co dalej. Cały model liczy czysty clientRecord; tu tylko widok
// + szybkie akcje na istniejących funkcjach. Teczka AI (audyt/oferta/skrypt) jest osobno, pod
// przyciskiem „Teczka AI". Cienki komponent na wspólnym Modal-u (dostępność + Escape centralnie).

type Tab = "overview" | "timeline" | "notes" | "finance";
const ICON: Record<string, string> = { note: "📝", email: "✉", finance: "💰" };

export default function ClientPanel({ leadId, onClose, onDossier, onMoney }: {
  leadId: string;
  onClose: () => void;
  /** Otwórz teczkę AI (LeadDetail) — audyt strony, analiza, e-mail, skrypt rozmowy. */
  onDossier?: (id: string) => void;
  /** Otwórz Finanse (powiązane projekty/płatności). */
  onMoney?: () => void;
}) {
  const { data } = useStore();
  const lead = data.leads.find((l) => l.id === leadId);
  const [tab, setTab] = useState<Tab>("overview");
  const [note, setNote] = useState("");
  const [tagInput, setTagInput] = useState("");

  if (!lead) {
    return (
      <Modal title="🪪 Panel klienta" onClose={onClose} foot={<button className="btn" onClick={onClose}>Zamknij</button>}>
        <p className="muted" style={{ padding: "8px 0" }}>Nie udało się wczytać klienta — mógł zostać usunięty. Zamknij i otwórz ponownie z listy.</p>
      </Modal>
    );
  }

  const rec = clientRecord(lead, store.data.sentMail, store.data.financeProjects);
  const set = (patch: Partial<Lead>) =>
    store.setData((d) => { const l = d.leads.find((x) => x.id === lead.id); if (l) Object.assign(l, patch, { updatedAt: Date.now() }); });
  const fmt = (ms: number) => new Date(ms).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  const fmtT = (ms: number) => new Date(ms).toLocaleString("pl-PL");

  const setStage = (status: LeadStatus) => {
    set({ status, notes: appendLeadNote(lead.notes, `➡ Etap zmieniony na: ${PIPELINE_STAGES.find((s) => s.id === status)?.label || status}`, Date.now()) });
  };
  const remind = (days: number) => {
    const at = reminderInDays(days);
    set({ nextFollowUpAt: at, notes: appendLeadNote(lead.notes, `⏰ Przypomnienie ustawione na ${fmt(at)}`, Date.now()) });
    toast(`⏰ Przypomnę o „${lead.company}” ${fmt(at)} (Plan dnia / follow-upy).`);
  };
  const saveNote = () => {
    const t = note.trim();
    if (!t) { toast("Wpisz treść notatki."); return; }
    set({ notes: appendLeadNote(lead.notes, t, Date.now()) });
    setNote("");
    toast("📝 Notatka zapisana w osi czasu.");
  };
  const doAddTag = (t: string) => { const v = t.trim(); if (!v) return; set({ tags: addTag(lead.tags, v) }); setTagInput(""); };

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "📋 Przegląd" },
    { id: "timeline", label: "🕘 Oś czasu" },
    { id: "notes", label: "📝 Notatki" },
    { id: "finance", label: "💰 Finanse" },
  ];
  const finProjects = (store.data.financeProjects || []).filter((p) => (p.leadId && p.leadId === lead.id) || (p.client || "").trim().toLowerCase() === lead.company.trim().toLowerCase());

  return (
    <Modal title={`🪪 ${rec.company}`} onClose={onClose} foot={<button className="btn" onClick={onClose}>Zamknij</button>}>
      {/* Etap lejka jako oś + selektor — jedno miejsce sterowania statusem sprzedaży. */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ height: 6, borderRadius: 999, background: "var(--line, rgba(128,128,128,.25))", overflow: "hidden" }}>
          <div style={{ width: `${Math.round(rec.progress * 100)}%`, height: "100%", background: rec.status === "lost" ? "#ff6b6b" : "var(--cyan, #39d0d8)", transition: "width .3s" }} />
        </div>
        <div className="chips" style={{ flexWrap: "wrap", marginTop: 6 }}>
          {PIPELINE_STAGES.map((s) => (
            <button key={s.id} className={`chip ${rec.status === s.id ? "on" : ""}`} style={{ fontSize: 12 }} onClick={() => setStage(s.id)}>{s.label}</button>
          ))}
        </div>
      </div>

      {/* Ostrzeżenie zgodności kontaktu — wprost, u góry. */}
      {(rec.optOut || rec.doNotContact) && (
        <div className="notice" style={{ marginBottom: 8, fontSize: 12.5, borderLeft: "3px solid #ff6b6b" }}>
          {rec.optOut ? "⛔ Kontakt wypisał się (opt-out) — nie wysyłaj wiadomości." : "🚫 Oznaczony „nie kontaktować” — tylko praca wewnętrzna."}
        </div>
      )}

      {/* Następny krok — najważniejsza rzecz na ekranie. */}
      <div className="journal-card" style={{ padding: "10px 12px", borderLeft: rec.card.overdue ? "3px solid var(--gold)" : undefined }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{rec.card.nextAction}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>🎯 Etap: {rec.stageLabel}</span>
          {rec.card.value != null && <span>💵 {rec.card.value.toLocaleString("pl-PL")} zł</span>}
          {rec.card.lastTouchAt && <span>🕘 Ostatni ślad: {fmt(rec.card.lastTouchAt)} ({rec.card.lastTouchWhat})</span>}
          {rec.card.emailCount > 0 && <span>✉ Maile: {rec.card.emailCount}</span>}
        </div>
      </div>

      {/* Szybkie akcje — dzwoń / mail / SMS / przypomnij / teczka AI. */}
      <div className="chips" style={{ flexWrap: "wrap", marginTop: 10 }}>
        {rec.phone && <button className="chip" onClick={() => window.open(`tel:${rec.phone!.replace(/\s/g, "")}`)}>📞 Zadzwoń</button>}
        {rec.email && !rec.optOut && <button className="chip" onClick={() => safeOpenExternal(mailtoUrl(rec.email!, `W sprawie współpracy — ${rec.company}`, ""))}>✉ Napisz mail</button>}
        {rec.phone && !rec.optOut && <button className="chip" onClick={() => safeOpenExternal(smsUrl(rec.phone!, `Dzień dobry, z tej strony ${store.settings.userName || "JARVIS"} — `))}>📱 SMS</button>}
        <button className="chip" onClick={() => window.open(mapsSearchUrl(`${rec.company} ${rec.address || lead.location || ""}`), "_blank", "noopener")}>🗺 Mapy/opinie</button>
        {onDossier && <button className="chip" onClick={() => onDossier(lead.id)}>🧠 Teczka AI</button>}
      </div>
      <div className="chips" style={{ flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
        {rec.status !== "lost" && !rec.optOut && (<>
          <span className="muted" style={{ fontSize: 12 }}>⏰ Przypomnij:</span>
          <button className="chip" onClick={() => remind(2)}>za 2 dni</button>
          <button className="chip" onClick={() => remind(7)}>za tydzień</button>
          <button className="chip" onClick={() => remind(30)}>za miesiąc</button>
        </>)}
      </div>

      {/* Zakładki */}
      <div className="chips" style={{ flexWrap: "wrap", marginTop: 12, borderBottom: "1px solid var(--line, rgba(128,128,128,.2))", paddingBottom: 6 }}>
        {TABS.map((t) => (
          <button key={t.id} className={`chip ${tab === t.id ? "on" : ""}`} style={{ fontSize: 12 }} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ marginTop: 10 }}>
          <div className="journal-card" style={{ padding: "10px 12px" }}>
            <div className="muted" style={{ fontSize: 13, display: "grid", gap: 4 }}>
              {rec.phone && <span>📞 {rec.phone} <button className="chip" style={{ fontSize: 11, padding: "0 6px", marginLeft: 4 }} onClick={() => copyWithToast(rec.phone!)}>kopiuj</button></span>}
              {rec.email && <span>✉ {rec.email} <button className="chip" style={{ fontSize: 11, padding: "0 6px", marginLeft: 4 }} onClick={() => copyWithToast(rec.email!)}>kopiuj</button></span>}
              {rec.url && <span>🌐 <a href="#" onClick={(e) => { e.preventDefault(); safeOpenExternal(rec.url); }}>{rec.url}</a></span>}
              {rec.address && <span>📍 {rec.address}</span>}
              {rec.hours && <span>🕐 {rec.hours}</span>}
              {!rec.phone && !rec.email && <span className="muted">📵 Brak danych kontaktowych — kliknij „🗺 Mapy/opinie”, żeby znaleźć numer.</span>}
            </div>
          </div>
          {/* Wartość dealu — edytowalna wprost */}
          <div className="journal-card" style={{ padding: "10px 12px", marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>💵 Wartość dealu:</span>
            <input type="number" className="input" style={{ width: 120 }} placeholder="zł" defaultValue={lead.value ?? ""} onBlur={(e) => set({ value: Number(e.target.value) || undefined })} />
            <span className="muted" style={{ fontSize: 12 }}>zł</span>
          </div>
          {/* Etykiety / segmenty */}
          <div className="journal-card" style={{ padding: "10px 12px", marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>🏷 Etykiety</div>
            <div className="chips" style={{ flexWrap: "wrap", gap: 6 }}>
              {rec.tags.map((t) => (
                <button key={t} className="chip on" onClick={() => set({ tags: removeTag(lead.tags, t) })} title="Kliknij, aby usunąć">{t} ✕</button>
              ))}
              {rec.tags.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Brak — dodaj, by grupować klientów.</span>}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="Nowa etykieta…" value={tagInput}
                onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doAddTag(tagInput); }} />
              <button className="chip" onClick={() => doAddTag(tagInput)}>+ Dodaj</button>
            </div>
            <div className="chips" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {suggestedTags(lead).map((t) => <button key={t} className="chip" style={{ fontSize: 11 }} onClick={() => doAddTag(t)}>+ {t}</button>)}
            </div>
          </div>
        </div>
      )}

      {tab === "timeline" && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {rec.timeline.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Brak zdarzeń. Zapisz pierwszą notatkę w zakładce 📝 Notatki.</p>}
          {rec.timeline.map((n, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.45, borderLeft: `2px solid ${n.kind === "finance" ? "var(--gold)" : "var(--line-strong, rgba(128,128,128,.4))"}`, paddingLeft: 8 }}>
              <span className="muted" style={{ fontSize: 11 }}>{ICON[n.kind] || "•"} {n.at ? fmtT(n.at) : "—"}</span>
              <div>{n.text}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "notes" && (
        <div style={{ marginTop: 10 }}>
          <textarea className="ta" style={{ minHeight: 64 }} value={note} placeholder="Co ustaliłeś po rozmowie? np. nie odebrał — oddzwonić jutro."
            onChange={(e) => setNote(e.target.value)} />
          <button className="btn" style={{ marginTop: 6 }} onClick={saveNote}>💾 Zapisz notatkę</button>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {rec.timeline.filter((n) => n.kind === "note").map((n, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.45, borderLeft: "2px solid var(--line-strong, rgba(128,128,128,.4))", paddingLeft: 8 }}>
                <span className="muted" style={{ fontSize: 11 }}>{n.at ? fmtT(n.at) : "—"}</span>
                <div>{n.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "finance" && (
        <div style={{ marginTop: 10 }}>
          {finProjects.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Brak powiązanych projektów finansowych. Dodasz je w 💰 Finansach (połączą się po nazwie lub ID klienta).</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {finProjects.map((p) => (
                <div key={p.id} className="journal-card" style={{ padding: "8px 10px", fontSize: 13 }}>
                  <b>{p.name}</b> — {p.amount.toLocaleString("pl-PL")} zł
                  <span className="muted" style={{ fontSize: 12 }}> · {p.status}{p.paidAmount ? ` · wpłacone ${p.paidAmount.toLocaleString("pl-PL")} zł` : ""}</span>
                </div>
              ))}
              <div className="muted" style={{ fontSize: 12 }}>Razem: {rec.card.financeTotal.toLocaleString("pl-PL")} zł{rec.card.financePaid > 0 ? ` (wpłacone ${rec.card.financePaid.toLocaleString("pl-PL")} zł)` : ""}</div>
            </div>
          )}
          {onMoney && <button className="btn" style={{ marginTop: 8 }} onClick={onMoney}>💰 Otwórz Finanse</button>}
        </div>
      )}
    </Modal>
  );
}
