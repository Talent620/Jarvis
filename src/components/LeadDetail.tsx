import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { buildDossier, auditWeakPoints, scoreLabel, smsDraft } from "../lib/leadIntel";
import { gmailComposeUrl, mailtoUrl, mapsSearchUrl, smsUrl, splitOffer } from "../lib/glinks";
import { canSendDirect, sendOfferEmail } from "../lib/mailer";
import { draftOffer } from "../lib/offer";
import { markContacted } from "../lib/salesEngine";
import { copyWithToast, toast } from "../lib/toast";
import { useEscape } from "../hooks/useEscape";
import type { Lead, LeadStatus } from "../types";

const STATUS: { id: LeadStatus; label: string }[] = [
  { id: "new", label: "Nowy" },
  { id: "contacted", label: "Kontakt" },
  { id: "offer", label: "Oferta" },
  { id: "won", label: "Klient ✅" },
  { id: "lost", label: "Odrzucony" },
];

/**
 * Teczka klienta — wszystko o leadzie w jednym miejscu: dane, audyt techniczny
 * strony, analiza AI słabych punktów, spersonalizowany e-mail i skrypt rozmowy.
 * Jesteś w 100% gotowy do kontaktu zanim podniesiesz słuchawkę.
 */
export default function LeadDetail({ leadId, onClose, onWeb }: { leadId: string; onClose: () => void; onWeb?: () => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const lead = data.leads.find((l) => l.id === leadId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!lead) return null;
  const intel = lead.intel;
  const phone = lead.contact && !lead.contact.includes("@") ? lead.contact : undefined;
  const email = lead.email || (lead.contact?.includes("@") ? lead.contact : undefined);
  const score = intel ? scoreLabel(intel.score) : null;
  const weak = intel ? auditWeakPoints(intel.audit, !!lead.url) : [];

  const run = async () => {
    setBusy(true);
    setMsg(lead.url ? "🔍 Audytuję stronę i analizuję słabe punkty…" : "🧠 Analizuję firmę i piszę materiały…");
    const r = await buildDossier(lead.id);
    setBusy(false);
    setMsg("error" in r ? `⚙ ${r.error}` : "✅ Teczka gotowa — audyt, analiza, e-mail i skrypt rozmowy poniżej.");
  };

  const set = (patch: Partial<Lead>) =>
    store.setData((d) => {
      const l = d.leads.find((x) => x.id === lead.id);
      if (l) Object.assign(l, patch, { updatedAt: Date.now() });
    });

  const sendVia = (kind: "gmail" | "mail") => {
    const text = intel?.email || lead.offer || "";
    const { subject, body } = splitOffer(text, `Oferta dla ${lead.company}`, store.settings.emailSignature);
    const url = kind === "gmail" ? gmailComposeUrl(email || "", subject, body) : mailtoUrl(email || "", subject, body);
    window.open(url, "_blank", "noopener");
    markContacted(lead.id);
  };

  // Prawdziwa wysyłka jednym potwierdzeniem: desktop → SMTP, telefon → Gmail (backend).
  const [sending, setSending] = useState(false);
  const sendNow = async () => {
    if (!email) { toast("Brak adresu e-mail firmy — użyj Gmaila i wpisz adres ręcznie."); return; }
    setSending(true);
    // Jeśli oferty jeszcze nie ma — JARVIS pisze ją sam (jedno kliknięcie = napisz i wyślij).
    let text = (intel?.email || lead.offer || "").trim();
    if (!text) { text = (await draftOffer(lead)).trim(); if (text) set({ offer: text }); }
    if (!text) { setSending(false); toast("Nie udało się napisać oferty — sprawdź klucz API (⚙ → Mózg)."); return; }
    const { subject, body } = splitOffer(text, `Oferta dla ${lead.company}`, store.settings.emailSignature);
    if (!window.confirm(`Wysłać e-mail do ${lead.company}?\n\nDo: ${email}\nTemat: ${subject}`)) { setSending(false); return; }
    const r = await sendOfferEmail(email, subject, body, lead.company);
    setSending(false);
    if (!r.ok) { toast(`Nie wysłano: ${r.error}`); return; }
    toast(`✅ Mail wysłany do ${email} (${r.via}) — zapisano w 📤 Skrzynce wysłanych`);
    markContacted(lead.id); // napędza follow-upy (Plan na dziś przypomni o ponagleniu)
    set({ status: lead.status === "new" || lead.status === "contacted" ? "offer" : lead.status, note: `${lead.note ? lead.note + " · " : ""}E-mail wysłany ${new Date().toLocaleDateString("pl-PL")}` });
  };

  const sendSms = () => {
    if (!phone) return;
    window.open(smsUrl(phone, smsDraft(lead, intel?.audit)), "_blank");
    markContacted(lead.id);
  };

  const audit = intel?.audit;
  const checks: { label: string; ok?: boolean }[] = audit?.ok
    ? [
        { label: "HTTPS (kłódka)", ok: audit.https },
        { label: "Wersja mobilna", ok: audit.viewport },
        { label: "Tytuł SEO", ok: !!audit.title && audit.title.length >= 10 },
        { label: "Opis w Google", ok: audit.metaDesc },
        { label: "Nagłówek H1", ok: audit.h1 },
        { label: "Podgląd przy udostępnianiu", ok: audit.og },
        { label: "Widoczny kontakt", ok: audit.contact },
        { label: "Social media", ok: !!audit.socials?.length },
      ]
    : [];

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🗂 {lead.company}</h2>
        </div>
        <div className="panel-body">
          {/* Scoring + status */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {score && (
              <span className="chip on" title="Szansa na sprzedaż wg JARVIS-a">
                {score.emoji} {intel!.score}/100 — lead {score.label}
              </span>
            )}
            <select
              value={lead.status}
              onChange={(e) => set({ status: e.target.value as LeadStatus })}
              style={{ width: "auto", padding: "4px 8px", borderRadius: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 13 }}
            >
              {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <input
              type="number"
              value={lead.value ?? ""}
              placeholder="wartość zł"
              onChange={(e) => set({ value: Number(e.target.value) || undefined })}
              style={{ width: 100, padding: "4px 8px", borderRadius: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 13 }}
            />
          </div>

          {/* Wszystkie dane — szybkie akcje */}
          <div className="journal-card" style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 13, display: "grid", gap: 4 }}>
              {(lead.niche || lead.location) && <span>🏷 {[lead.niche, lead.location].filter(Boolean).join(" · ")}</span>}
              {lead.address && <span>📍 {lead.address}</span>}
              {phone && <span>📞 {phone}</span>}
              {email && <span>✉ {email}</span>}
              {lead.url && <span>🌐 {lead.url}</span>}
              {lead.hours && <span>🕐 {lead.hours}</span>}
              {lead.note && <span>📝 {lead.note}</span>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {phone && <button className="chip" onClick={() => window.open(`tel:${phone.replace(/\s/g, "")}`)}>📞 Zadzwoń</button>}
              {phone && <button className="chip" onClick={sendSms}>📱 SMS z zaczepką</button>}
              {lead.url && <button className="chip" onClick={() => window.open(lead.url, "_blank", "noopener")}>🌐 Strona</button>}
              <button className="chip" onClick={() => window.open(mapsSearchUrl(`${lead.company} ${lead.address || lead.location || ""}`), "_blank", "noopener")}>🗺 Mapy/opinie</button>
              {phone && <button className="chip" onClick={() => copyWithToast(phone)}>📋 Telefon</button>}
              {email && <button className="chip" onClick={() => copyWithToast(email)}>📋 E-mail</button>}
            </div>
          </div>

          {/* Teczka — jedna akcja */}
          <button className="btn primary" style={{ marginTop: 10 }} onClick={run} disabled={busy}>
            {busy ? "🧠 Pracuję…" : intel?.analysis ? "🧠 Odśwież teczkę (audyt + analiza AI)" : "🧠 Przygotuj teczkę klienta (audyt + analiza AI)"}
          </button>
          {msg && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{msg}</p>}
          {!intel && !busy && (
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              JARVIS sprawdzi stronę firmy (HTTPS, mobilność, SEO, kontakt…), oceni szansę 0–100,
              wypisze słabe punkty z rozwiązaniami i przygotuje e-mail + skrypt rozmowy — pod tę konkretną firmę.
            </p>
          )}

          {/* Audyt techniczny */}
          {audit && (
            <>
              <h3 style={{ marginTop: 14 }}>🔍 Audyt techniczny strony</h3>
              {audit.ok ? (
                <div className="chips" style={{ flexWrap: "wrap" }}>
                  {checks.map((c) => (
                    <span key={c.label} className="chip" style={{ borderColor: c.ok ? "var(--ok, #58e08a)" : "#e05858" }}>
                      {c.ok ? "✅" : "❌"} {c.label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>{audit.error || "Nie udało się pobrać strony."}</p>
              )}
              {weak.length > 0 && (
                <div className="journal-card" style={{ marginTop: 8 }}>
                  <b style={{ fontSize: 13 }}>Słabe punkty (twarde fakty do rozmowy):</b>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--text-dim)" }}>
                    {weak.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
          {!audit && intel && !lead.url && (
            <div className="journal-card" style={{ marginTop: 10 }}>
              <b style={{ fontSize: 13 }}>🔥 Brak strony www</b>
              <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
                Najlepszy możliwy lead dla agencji: firma działa, ma telefon, a w Google jest niewidoczna.
                Zbuduj demo i pokaż im, co tracą.
              </p>
            </div>
          )}

          {/* Analiza AI */}
          {intel?.analysis && (
            <>
              <h3 style={{ marginTop: 14 }}>🧠 Analiza AI — jak to sprzedać</h3>
              <div className="journal-card">
                <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{intel.analysis}</p>
                <button className="chip" style={{ marginTop: 8 }} onClick={() => copyWithToast(intel.analysis!)}>📋 Kopiuj analizę</button>
              </div>
            </>
          )}

          {/* Brak szkicu, ale można wysłać wprost — jedno kliknięcie: napisz i wyślij */}
          {!(intel?.email || lead.offer) && canSendDirect() && email && (
            <button
              className="chip"
              style={{ marginTop: 14, borderColor: "var(--ok, #58e08a)", fontWeight: 600 }}
              onClick={sendNow}
              disabled={sending}
            >
              {sending ? "📨 Piszę i wysyłam…" : "📨 Napisz i wyślij (JARVIS sam napisze)"}
            </button>
          )}

          {/* E-mail */}
          {(intel?.email || lead.offer) && (
            <>
              <h3 style={{ marginTop: 14 }}>✉ Spersonalizowany e-mail</h3>
              <div className="journal-card">
                <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{intel?.email || lead.offer}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {canSendDirect() && email && (
                    <button className="chip" style={{ borderColor: "var(--ok, #58e08a)" }} onClick={sendNow} disabled={sending}>
                      {sending ? "📨 Wysyłam…" : "📨 WYŚLIJ TERAZ (potwierdź)"}
                    </button>
                  )}
                  <button className="chip" onClick={() => sendVia("gmail")}>✉ Gmail</button>
                  <button className="chip" onClick={() => sendVia("mail")}>📧 Program pocztowy</button>
                  {phone && <button className="chip" onClick={sendSms}>📱 SMS</button>}
                  <button className="chip" onClick={() => copyWithToast(intel?.email || lead.offer || "")}>📋 Kopiuj</button>
                </div>
                {!canSendDirect() && email && (
                  <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                    💡 Chcesz wysyłać jednym kliknięciem, bez otwierania poczty? Na Windows: ⚙ → Poczta.
                    Na telefonie: ⚙ → Synchronizacja → „Połącz konto Google" (wysyłka przez Gmaila w tle).
                  </p>
                )}
                {!email && <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Brak e-maila firmy — wiadomość otworzy się bez adresata (uzupełnij po znalezieniu adresu na stronie/Mapach).</p>}
              </div>
            </>
          )}

          {/* Skrypt rozmowy */}
          {intel?.callScript && (
            <>
              <h3 style={{ marginTop: 14 }}>📞 Skrypt rozmowy telefonicznej</h3>
              <div className="journal-card">
                <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{intel.callScript}</p>
                <button className="chip" style={{ marginTop: 8 }} onClick={() => copyWithToast(intel.callScript!)}>📋 Kopiuj skrypt</button>
              </div>
            </>
          )}

          {onWeb && (
            <button className="btn" style={{ marginTop: 14 }} onClick={onWeb}>
              🌐 Zbuduj demo strony dla tej firmy
            </button>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>← Wróć do listy</button>
        </div>
      </div>
    </div>
  );
}
