import { useMemo, useState } from "react";
import { store, uid } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { draftOffer } from "../lib/offer";
import { splitOffer } from "../lib/glinks";
import { canSendDirect, draftAndSendOffer, sentTodayCount, sendAllOffers } from "../lib/mailer";
import { findLeads } from "../lib/leads";
import { buildDossiers, scoreLabel } from "../lib/leadIntel";
import { leadsToCsv, followUpsDue, callNowList, searchLeads, wasLeadEmailed } from "../lib/salesEngine";
import { importLeads } from "../lib/leadImport";
import { copyWithToast, toast } from "../lib/toast";
import type { Lead, LeadStatus } from "../types";
import { useEscape } from "../hooks/useEscape";
import LeadDetail from "./LeadDetail";
import SalesPlan from "./SalesPlan";

const STATUS: { id: LeadStatus; label: string; color: string }[] = [
  { id: "new", label: "Nowy", color: "var(--cyan)" },
  { id: "contacted", label: "Kontakt", color: "#9b8cff" },
  { id: "offer", label: "Oferta", color: "var(--gold)" },
  { id: "won", label: "Klient ✅", color: "var(--ok, #58e08a)" },
  { id: "lost", label: "Odrzucony", color: "var(--text-dim)" },
];

export default function SalesDashboard({ onClose, onWeb, onMoney }: { onClose: () => void; onWeb?: () => void; onMoney?: () => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const leads = data.leads || [];
  const [filter, setFilter] = useState<LeadStatus | "all" | "call" | "emailed">("all");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ company: "", contact: "", value: "" });
  const [drafting, setDrafting] = useState<string>("");
  const [sending, setSending] = useState<string>("");
  const [hunting, setHunting] = useState(false);
  const [huntMsg, setHuntMsg] = useState("");
  const [niche, setNiche] = useState(store.settings.prospectNiche || "");
  const [city, setCity] = useState(store.settings.prospectLocation || "");
  const [noWeb, setNoWeb] = useState(false);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [bulking, setBulking] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");

  const doImport = () => {
    if (!importText.trim()) return;
    const r = importLeads(importText);
    setImportText("");
    setShowImport(false);
    setFilter("all");
    toast(r.added ? `Zaimportowano ${r.added} z ${r.total} leadów ✓` : "Brak nowych — wszystkie już masz na liście.");
  };

  // Licznik działań na dziś (do plakietki na przycisku planu).
  const todoCount = (callNowList(leads).length ? 1 : 0) && (callNowList(leads).length + followUpsDue(leads).length);

  // Eksport leadów do pliku CSV (Excel/Arkusze Google).
  const exportCsv = () => {
    if (!leads.length) { toast("Brak leadów do eksportu."); return; }
    const csv = "﻿" + leadsToCsv(leads); // BOM → polskie znaki w Excelu
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `leady-jarvis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Wyeksportowano ${leads.length} leadów ✓`);
  };

  // Teczki dla wszystkich NOWYCH leadów naraz: audyt + analiza + e-mail + skrypt.
  const bulkDossiers = async () => {
    const fresh = (store.data.leads || []).filter((l) => l.status === "new" && !l.intel?.analysis).slice(0, 10);
    if (!fresh.length) { setBulkMsg("Brak nowych leadów bez teczki — wszystko już przygotowane."); return; }
    setBulking(true);
    const ok = await buildDossiers(fresh.map((l) => l.id), (done, total) => setBulkMsg(`🧠 Przygotowuję teczki… ${done}/${total}`));
    setBulking(false);
    setBulkMsg(`✅ Gotowe ${ok}/${fresh.length} teczek — każdy lead ma audyt, analizę, e-mail i skrypt rozmowy.`);
  };

  // Masowa wysyłka ofert: do wszystkich leadów z e-mailem, którzy nie byli mailowani.
  const sendAll = async () => {
    if (!canSendDirect()) { setBulkMsg("Najpierw skonfiguruj pocztę: ⚙ → Poczta (adres + hasło aplikacji). Bez tego użyj „📧 Napisz i otwórz pocztę” przy leadzie."); return; }
    const all = store.data.leads || [];
    const withEmail = all.filter((l) => leadEmail(l));
    const targets = withEmail.filter((l) => !wasLeadEmailed(l, store.data.sentMail || []));
    if (!all.length) { setBulkMsg("Pulpit jest pusty — najpierw znajdź leady (🔎 Znajdź leady)."); return; }
    if (!withEmail.length) { setBulkMsg(`Żaden z ${all.length} leadów nie ma adresu e-mail — dodaj kontakty (klik w leada) lub znajdź firmy z e-mailem.`); return; }
    if (!targets.length) { setBulkMsg(`Wszyscy leadzi z e-mailem (${withEmail.length}) są już zmailowani. Znajdź nowych, by wysłać kolejne.`); return; }
    const cap = Math.min(25, targets.length);
    if (!window.confirm(`Wysłać ofertę do ${cap} leadów (z e-mailem, jeszcze niemailowanych)?\n\nMaks. 25 na turę. Każdy dostanie spersonalizowaną ofertę.`)) return;
    setBulking(true);
    setBulkMsg(`📤 Wysyłam oferty… (do ${cap})`);
    const r = await sendAllOffers(cap, (done, total) => setBulkMsg(`📤 Wysyłam… ${done}/${total}`));
    setBulking(false);
    const parts = [`✅ Wysłano ${r.sent}.`];
    if (r.alreadyEmailed) parts.push(`pominięto ${r.alreadyEmailed} mailowanych`);
    if (r.noEmail) parts.push(`${r.noEmail} bez e-maila`);
    if (r.failed) parts.push(`⚠ nieudane ${r.failed}`);
    setBulkMsg(parts.join(" · ") + " — szczegóły w 📤 Skrzynce wysłanych.");
  };

  // „Znajdź leady" — od ręki, prosto z pulpitu. Darmowe (OpenStreetMap), z
  // telefonami. Nisza i miasto są OPCJONALNE (bez miasta użyje lokalizacji).
  const hunt = async () => {
    if (city.trim()) store.setSettings({ prospectNiche: niche.trim(), prospectLocation: city.trim() });
    setHunting(true);
    setHuntMsg(noWeb ? "🔎 Szukam firm BEZ strony (idealni klienci)…" : "🔎 Szukam firm w okolicy…");
    const r = await findLeads({ niche: niche.trim() || undefined, location: city.trim() || undefined, count: 15, onlyNoWebsite: noWeb });
    setHunting(false);
    if (r.error) {
      setHuntMsg(`⚙ ${r.error}`);
    } else if (r.added > 0) {
      setHuntMsg(`✅ Znalazłem ${r.found} firm w ${r.city} i dodałem ${r.added} nowych. Są na liście.`);
      setFilter("all");
    } else {
      setHuntMsg(`Znalazłem ${r.found} firm w ${r.city}, ale wszystkie już masz na liście.`);
    }
  };

  const writeOffer = async (l: Lead) => {
    setDrafting(l.id);
    const offer = await draftOffer(l);
    setDrafting("");
    if (offer)
      store.setData((d) => {
        const x = d.leads.find((y) => y.id === l.id);
        if (x) { x.offer = offer; if (x.status === "new") x.status = "offer"; x.updatedAt = Date.now(); }
      });
    else toast("Nie udało się napisać oferty — sprawdź klucz AI (⚙ → AI) i spróbuj ponownie.");
  };
  // E-mail leada: najpierw dedykowane pole `email` (z OSM/strony), w razie braku — `contact`.
  // To naprawia „nie wysyła się z tego miejsca": adres bywał w `email`, a kod patrzył tylko na `contact`.
  const leadEmail = (l: Lead): string => {
    const e = (l.email || "").trim();
    if (e.includes("@")) return e;
    const c = (l.contact || "").trim();
    return c.includes("@") ? c : "";
  };

  // Gdy automatyczna wysyłka nie jest skonfigurowana — i tak da się wysłać: napisz ofertę
  // (jeśli brak) i otwórz gotową wiadomość w domyślnej poczcie (mailto). Zawsze działa.
  const writeAndOpenMail = async (l: Lead) => {
    const to = leadEmail(l);
    if (!to) { toast("Ten lead nie ma adresu e-mail — dodaj go w 🗂 Teczce."); return; }
    let offer = l.offer;
    if (!offer) {
      setDrafting(l.id);
      offer = await draftOffer(l);
      setDrafting("");
      if (offer) store.setData((d) => { const x = d.leads.find((y) => y.id === l.id); if (x) { x.offer = offer; if (x.status === "new") x.status = "offer"; x.updatedAt = Date.now(); } });
    }
    const { subject, body } = splitOffer(offer || "", `Oferta dla ${l.company}`, store.settings.emailSignature);
    window.open(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
  };

  const sendOffer = (l: Lead) => {
    const { subject, body } = splitOffer(l.offer || "", `Oferta dla ${l.company}`, store.settings.emailSignature);
    const to = leadEmail(l);
    window.open(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
  };

  // „Napisz i wyślij" — jedno kliknięcie: JARVIS pisze ofertę (jeśli brak), dopisuje
  // podpis i wysyła sam (SMTP/Gmail). Użytkownik tylko potwierdza adresata.
  const writeAndSend = async (l: Lead) => {
    const to = leadEmail(l);
    if (!to) { toast("Ten lead nie ma adresu e-mail — dodaj go w 🗂 Teczce, żeby wysłać."); return; }
    setSending(l.id);
    const r = await draftAndSendOffer(l, to);
    setSending("");
    if (r.offer && r.offer !== l.offer) {
      store.setData((d) => {
        const x = d.leads.find((y) => y.id === l.id);
        if (x) { x.offer = r.offer; x.updatedAt = Date.now(); }
      });
    }
    if (!r.ok) { toast(`Nie wysłano: ${r.error}`); return; }
    toast(`✅ Mail wysłany do ${to} (${r.via}) — zapisano w 📤 Skrzynce wysłanych`);
    store.setData((d) => {
      const x = d.leads.find((y) => y.id === l.id);
      if (x) { if (x.status === "new" || x.status === "contacted") x.status = "offer"; x.updatedAt = Date.now(); }
    });
  };

  const setStatus = (id: string, status: LeadStatus) =>
    store.setData((d) => {
      const l = d.leads.find((x) => x.id === id);
      if (l) {
        l.status = status;
        l.updatedAt = Date.now();
      }
    });
  const setField = (id: string, patch: Partial<Lead>) =>
    store.setData((d) => {
      const l = d.leads.find((x) => x.id === id);
      if (l) Object.assign(l, patch, { updatedAt: Date.now() });
    });
  const del = (id: string) => {
    if (!window.confirm("Usun\u0105\u0107 ten lead (razem z ofert\u0105)?")) return;
    store.setData((d) => { d.leads = d.leads.filter((x) => x.id !== id); });
  };

  const add = () => {
    const c = form.company.trim();
    if (!c) return;
    if (leads.some((l) => l.company.trim().toLowerCase() === c.toLowerCase())) {
      toast(`„${c}" jest już na liście.`);
      return;
    }
    store.setData((d) =>
      d.leads.unshift({ id: uid(), company: c, contact: form.contact.trim() || undefined, value: Number(form.value) || undefined, status: "new", createdAt: Date.now(), updatedAt: Date.now() }),
    );
    setForm({ company: "", contact: "", value: "" });
    toast(`➕ Dodano: ${c}`);
  };

  const stats = useMemo(() => {
    const won = leads.filter((l) => l.status === "won");
    const pipeline = leads.filter((l) => l.status !== "lost" && l.status !== "won");
    return {
      total: leads.length,
      won: won.length,
      earned: won.reduce((s, l) => s + (l.value || 0), 0),
      potential: pipeline.reduce((s, l) => s + (l.value || 0), 0),
    };
  }, [leads]);

  // Gorące leady (wysoki score z teczki) na górze — wiesz, do kogo dzwonić najpierw.
  const sent = data.sentMail || [];
  // Liczniki CRM (pytania szefa): klienci / do dzwonienia / mailowani / odrzuceni.
  const crm = useMemo(() => ({
    call: leads.filter((l) => l.status === "new" || l.status === "contacted").length,
    emailed: leads.filter((l) => wasLeadEmailed(l, sent)).length,
    won: leads.filter((l) => l.status === "won").length,
    lost: leads.filter((l) => l.status === "lost").length,
  }), [leads, sent]);

  // Ilu leadów dostanie ofertę przy masowej wysyłce: z e-mailem i jeszcze niemailowanych.
  const mailTargets = useMemo(
    () => leads.filter((l) => leadEmail(l) && !wasLeadEmailed(l, sent)).length,
    [leads, sent],
  );

  const shown = useMemo(() => {
    const match = (l: Lead) =>
      filter === "all" ? true
      : filter === "call" ? (l.status === "new" || l.status === "contacted")
      : filter === "emailed" ? wasLeadEmailed(l, sent)
      : l.status === filter;
    const base = searchLeads(leads.filter(match), query);
    return [...base].sort((a, b) => (b.intel?.score ?? -1) - (a.intel?.score ?? -1));
  }, [leads, filter, query, sent]);
  const copy = (t?: string) => t && copyWithToast(t);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📈 Pulpit Sprzedaży</h2>
        </div>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--gold)" }}>{stats.potential} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>potencjał w toku</div>
            </div>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--ok, #58e08a)" }}>{stats.earned} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>zarobione ({stats.won})</div>
            </div>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--cyan, #6ce7ff)" }}>{sentTodayCount(data.sentMail || [])}</div>
              <div className="muted" style={{ fontSize: 11 }}>✉ wysłane dziś</div>
            </div>
          </div>

          {/* Szukanie leadów — wszystko z pulpitu, bez wchodzenia do ustawień */}
          <div className="field" style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={niche} placeholder="Nisza — opcjonalnie (np. fryzjer)" onChange={(e) => setNiche(e.target.value)} style={{ flex: 1 }} />
            <input value={city} placeholder="Miasto — opcjonalnie (np. Kraków)" onChange={(e) => setCity(e.target.value)} style={{ flex: 1 }} />
          </div>
          <label className="row" style={{ cursor: "pointer", marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>🌐 Tylko firmy <b>bez strony www</b> (idealni klienci dla agencji stron)</span>
            <input type="checkbox" checked={noWeb} onChange={(e) => setNoWeb(e.target.checked)} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={hunt} disabled={hunting}>
              {hunting ? "🔎 Szukam…" : "🔎 Znajdź leady"}
            </button>
            {onWeb && (
              <button className="btn" style={{ flex: 1 }} onClick={onWeb}>🌐 Zbuduj demo</button>
            )}
          </div>
          {onMoney && (
            <button className="btn" style={{ marginTop: 8 }} onClick={onMoney}>💰 Centrum Zarabiania</button>
          )}
          {huntMsg && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{huntMsg}</p>}

          {/* Masowa wysyłka jednym kliknięciem — od razu widoczna na górze Pulpitu. */}
          <button
            className="btn primary"
            style={{ width: "100%", marginTop: 8, borderColor: "var(--ok, #58e08a)" }}
            onClick={sendAll}
            disabled={bulking}
            title="Wyślij spersonalizowaną ofertę do wszystkich leadów z e-mailem, którzy nie byli jeszcze mailowani"
          >
            {bulking ? "📤 Wysyłam…" : `📨 Wyślij oferty do wszystkich${mailTargets ? ` (${mailTargets})` : ""}`}
          </button>
          {bulkMsg && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{bulkMsg}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => setShowPlan(true)}>
              🎯 Plan na dziś{todoCount ? ` (${todoCount})` : ""}
            </button>
            <button className="btn" onClick={() => setShowImport((v) => !v)} title="Wklej listę firm">📥 Import</button>
            <button className="btn" onClick={exportCsv} title="Eksport do Excela/Arkuszy">📤 CSV</button>
          </div>
          {showImport && (
            <div style={{ marginTop: 8 }}>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={"Wklej listę firm — jedna na linię, albo z danymi:\nSalon Ola, 600100200, biuro@ola.pl, Kraków\nWarsztat Marek; 501502503; Wrocław"}
                className="ta" style={{ minHeight: "14vh", fontSize: 13 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" style={{ flex: 1 }} onClick={doImport}>✅ Importuj</button>
                <button className="btn" onClick={() => { setShowImport(false); setImportText(""); }}>Anuluj</button>
              </div>
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Rozpoznaję telefon, e-mail, stronę i miasto automatycznie. Obsługuję też CSV z nagłówkiem (Firma, Telefon, E-mail, Miasto).
              </p>
            </div>
          )}
          <button className="btn" style={{ marginTop: 8 }} onClick={bulkDossiers} disabled={bulking}>
            {bulking ? "🧠 Pracuję…" : "🧠 Teczki dla wszystkich nowych (audyt + analiza + e-maile)"}
          </button>

          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            <b>Kliknij firmę</b>, by otworzyć teczkę klienta: pełne dane, audyt strony, analizę AI
            słabych punktów, spersonalizowany e-mail i skrypt rozmowy. Gorące leady 🔥 lądują na górze.
          </p>

          {leads.length > 8 && (
            <input
              className="ta"
              style={{ minHeight: 0, padding: "8px 10px", margin: "4px 0 8px" }}
              placeholder="🔎 szukaj w leadach (firma, kontakt, miasto, notatka)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {/* CRM — szybkie kubełki: kto skorzystał, do kogo dzwonić, kogo mailowaliśmy, kto odrzucił */}
          <div className="chips" style={{ flexWrap: "wrap", margin: "4px 0 4px" }}>
            <span className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")} style={{ cursor: "pointer" }}>wszyscy ({leads.length})</span>
            <span className={`chip ${filter === "won" ? "on" : ""}`} onClick={() => setFilter("won")} style={{ cursor: "pointer" }}>✅ Klienci ({crm.won})</span>
            <span className={`chip ${filter === "call" ? "on" : ""}`} onClick={() => setFilter("call")} style={{ cursor: "pointer" }}>📞 Do dzwonienia ({crm.call})</span>
            <span className={`chip ${filter === "emailed" ? "on" : ""}`} onClick={() => setFilter("emailed")} style={{ cursor: "pointer" }}>✉ Mailowani ({crm.emailed})</span>
            <span className={`chip ${filter === "lost" ? "on" : ""}`} onClick={() => setFilter("lost")} style={{ cursor: "pointer" }}>❌ Odrzucili ({crm.lost})</span>
          </div>
          {/* Pełne statusy (etap lejka) */}
          <div className="chips" style={{ flexWrap: "wrap", margin: "0 0 8px" }}>
            {STATUS.map((s) => (
              <span key={s.id} className={`chip ${filter === s.id ? "on" : ""}`} onClick={() => setFilter(s.id)} style={{ cursor: "pointer", fontSize: 12 }}>
                {s.label} ({leads.filter((l) => l.status === s.id).length})
              </span>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "16px 0" }}>Brak leadów. Poproś JARVIS-a, by je znalazł i zapisał.</p>
          ) : (
            shown.map((l) => (
              <div key={l.id} className="journal-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <b style={{ cursor: "pointer" }} onClick={() => setOpenLead(l.id)}>
                    {l.intel ? `${scoreLabel(l.intel.score).emoji} ` : ""}{l.company}
                    {wasLeadEmailed(l, data.sentMail || []) && (
                      <span className="chip" style={{ marginLeft: 6, fontSize: 11, color: "var(--ok, #58e08a)", padding: "1px 8px" }}>✉ wysłano</span>
                    )}
                  </b>
                  <span className="x" style={{ cursor: "pointer" }} onClick={() => del(l.id)}>✕</span>
                </div>
                {(l.niche || l.location) && <div className="muted" style={{ fontSize: 12 }}>{[l.niche, l.location].filter(Boolean).join(" · ")}{l.intel ? ` · szansa ${l.intel.score}/100` : ""}</div>}
                {l.note && <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>{l.note}</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
                  <select
                    value={l.status}
                    onChange={(e) => setStatus(l.id, e.target.value as LeadStatus)}
                    style={{ width: "auto", padding: "4px 8px", borderRadius: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 13 }}
                  >
                    {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <input
                    type="number"
                    value={l.value ?? ""}
                    placeholder="zł"
                    onChange={(e) => setField(l.id, { value: Number(e.target.value) || undefined })}
                    style={{ width: 70, padding: "4px 8px", borderRadius: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 13 }}
                  />
                  <button className="chip" onClick={() => setOpenLead(l.id)}>🗂 Teczka</button>
                  {l.url && <button className="chip" onClick={() => window.open(l.url, "_blank", "noopener")}>🌐 WWW</button>}
                  {l.contact && <button className="chip" onClick={() => copy(l.contact)}>📋 Kontakt</button>}
                  <button className="chip" onClick={() => writeOffer(l)} disabled={drafting === l.id}>
                    {drafting === l.id ? "✍ Piszę…" : l.offer ? "✍ Napisz ponownie" : "✍ Szkic oferty"}
                  </button>
                  {leadEmail(l) ? (
                    canSendDirect() ? (
                      <button
                        className="chip"
                        style={{ borderColor: "var(--ok, #58e08a)", fontWeight: 600 }}
                        onClick={() => writeAndSend(l)}
                        disabled={sending === l.id}
                      >
                        {sending === l.id ? "📨 Wysyłam…" : "📨 Napisz i wyślij"}
                      </button>
                    ) : (
                      <button
                        className="chip"
                        style={{ borderColor: "var(--gold)", fontWeight: 600 }}
                        onClick={() => writeAndOpenMail(l)}
                        disabled={drafting === l.id}
                        title="Automatyczna wysyłka nie jest skonfigurowana — otworzę gotową wiadomość w Twojej poczcie"
                      >
                        {drafting === l.id ? "✍ Piszę…" : "📧 Napisz i otwórz pocztę"}
                      </button>
                    )
                  ) : (
                    <button className="chip" onClick={() => toast("Ten lead nie ma adresu e-mail — dodaj go w 🗂 Teczce, żeby wysłać ofertę.")}>
                      📧 Brak e-maila
                    </button>
                  )}
                </div>
                {l.offer && (
                  <div style={{ marginTop: 8, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
                    <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{l.offer}</p>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button className="chip" onClick={() => copy(l.offer)}>📋 Kopiuj ofertę</button>
                      <button className="chip" onClick={() => sendOffer(l)}>📧 Otwórz w poczcie</button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          <h3 style={{ marginTop: 14 }}>➕ Dodaj ręcznie</h3>
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <input value={form.company} placeholder="Firma" onChange={(e) => setForm({ ...form, company: e.target.value })} style={{ flex: 2 }} />
            <input type="number" value={form.value} placeholder="zł" onChange={(e) => setForm({ ...form, value: e.target.value })} style={{ flex: 1 }} />
          </div>
          <div className="field"><input value={form.contact} placeholder="Kontakt (e-mail/tel.)" onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
          <button className="btn primary" onClick={add}>💾 Dodaj lead</button>
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
      {openLead && <LeadDetail leadId={openLead} onClose={() => setOpenLead(null)} onWeb={onWeb} />}
      {showPlan && <SalesPlan onClose={() => setShowPlan(false)} onLead={(id) => { setShowPlan(false); setOpenLead(id); }} />}
    </div>
  );
}
