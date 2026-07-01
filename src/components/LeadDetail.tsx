import { useState } from "react";
import { buildGrowthContext, type GrowthContext } from "../lib/growthContext";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { buildDossier, auditWeakPoints, scoreLabel, smsDraft } from "../lib/leadIntel";
import { gmailComposeUrl, mailtoUrl, mapsSearchUrl, smsUrl, splitOffer, safeOpenExternal } from "../lib/glinks";
import { scoreDeliverability, deliverabilityLabel } from "../lib/emailDeliverability";
import { applyComposerAction, COMPOSER_ACTIONS, type ComposerAction } from "../lib/emailComposer";
import { canSendDirect, sendOfferEmail } from "../lib/mailer";
import { draftOffer } from "../lib/offer";
import { markContacted } from "../lib/salesEngine";
import { nextStatusAfterContact } from "../lib/leadContact";
import { leadTimeline, appendLeadNote } from "../lib/leadNotes";
import { salesOsConfigured, outreachViaSalesOs, leadToOutreachInput, pushLeadStatusToSalesOs } from "../lib/salesOs";
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
export default function LeadDetail({ leadId, onClose, onWeb }: { leadId: string; onClose: () => void; onWeb?: (ctx?: GrowthContext) => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const lead = data.leads.find((l) => l.id === leadId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Hooki MUSZĄ być przed wczesnym returnem (stała liczba/kolejność hooków co render).
  const [sending, setSending] = useState(false);
  const [osSending, setOsSending] = useState(false);
  const [composing, setComposing] = useState<ComposerAction | "">(""); // która akcja kompozytora trwa
  const [noteInput, setNoteInput] = useState(""); // dziennik kontaktu — nowa notatka po rozmowie
  // Po otwarciu zewnętrznego kompozytora (Gmail/mailto/SMS) NIE oznaczamy kontaktu automatycznie —
  // czekamy na jawne potwierdzenie użytkownika ("wysłałem"). To eliminuje fałszywe follow-upy.
  const [awaitingConfirm, setAwaitingConfirm] = useState<"" | "mail" | "sms">("");

  // „Teczka się nie otwiera": zamiast cicho renderować NIC (gdy lead zniknął), pokaż czytelny
  // panel z możliwością zamknięcia — koniec wrażenia „nie działa".
  if (!lead) {
    return (
      <div className="sheet" onClick={onClose}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <div className="panel-head"><div className="grabber" /><h2>🗂 Teczka klienta</h2></div>
          <div className="panel-body"><p className="muted" style={{ padding: "8px 0" }}>Nie udało się wczytać tego leada — mógł zostać usunięty lub lista jeszcze się ładuje. Zamknij i otwórz ponownie z listy.</p></div>
          <div className="panel-foot"><button className="btn" onClick={onClose}>Zamknij</button></div>
        </div>
      </div>
    );
  }
  const intel = lead.intel;
  const phone = lead.contact && !lead.contact.includes("@") ? lead.contact : undefined;
  const email = lead.email || (lead.contact?.includes("@") ? lead.contact : undefined);
  // Defensywnie: uszkodzone dane dossier (audit/score) NIE mogą zablokować otwarcia teczki.
  let score: ReturnType<typeof scoreLabel> | null = null;
  let weak: string[] = [];
  try { score = intel ? scoreLabel(intel.score) : null; } catch { /* ignore */ }
  try { weak = intel ? auditWeakPoints(intel.audit, !!lead.url) : []; } catch { weak = []; }

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

  // ✍ Akcje AI kompozytora — przerób bieżący draft maila (skróć/rozwiń/CTA/ton/przepisz).
  const runComposer = async (action: ComposerAction) => {
    const current = (intel?.email || lead.offer || "").trim();
    if (!current) { toast("Najpierw wygeneruj treść maila."); return; }
    setComposing(action);
    const out = await applyComposerAction(current, action);
    set({ offer: out, intel: intel ? { ...intel, email: out } : intel });
    setComposing("");
  };
  const sendVia = (kind: "gmail" | "mail") => {
    const text = intel?.email || lead.offer || "";
    const { subject, body } = splitOffer(text, `Oferta dla ${lead.company}`, store.settings.emailSignature);
    const url = kind === "gmail" ? gmailComposeUrl(email || "", subject, body) : mailtoUrl(email || "", subject, body);
    window.open(url, "_blank", "noopener");
    // Otwarcie kompozytora ≠ wysyłka. Prosimy o jawne potwierdzenie zamiast zmyślać kontakt.
    setAwaitingConfirm("mail");
  };

  // Jawne potwierdzenie użytkownika po wysłaniu z zewnętrznego kompozytora (Gmail/mailto/SMS).
  const confirmContact = (channel: "mail" | "sms") => {
    markContacted(lead.id);
    const label = channel === "sms" ? "SMS wysłany" : "E-mail wysłany";
    set({
      status: nextStatusAfterContact(lead.status),
      notes: appendLeadNote(lead.notes, `${label} (potwierdzone ręcznie) ${new Date().toLocaleDateString("pl-PL")}`, Date.now()),
    });
    setAwaitingConfirm("");
    toast("✓ Zapisano kontakt — follow-up ruszy z potwierdzonej wysyłki");
  };

  // Prawdziwa wysyłka jednym potwierdzeniem: desktop → SMTP, telefon → Gmail (backend).
  const sendNow = async () => {
    if (!email) { toast("Brak adresu e-mail firmy — użyj Gmaila i wpisz adres ręcznie."); return; }
    setSending(true);
    // Jeśli oferty jeszcze nie ma — JARVIS pisze ją sam (jedno kliknięcie = napisz i wyślij).
    let text = (intel?.email || lead.offer || "").trim();
    if (!text) { text = (await draftOffer(lead)).trim(); if (text) set({ offer: text }); }
    if (!text) { setSending(false); toast("Nie udało się napisać oferty — sprawdź klucz API (⚙ → Mózg)."); return; }
    const { subject, body } = splitOffer(text, `Oferta dla ${lead.company}`, store.settings.emailSignature);
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
    // Otwarcie aplikacji SMS ≠ wysłany SMS. Czekamy na potwierdzenie użytkownika.
    setAwaitingConfirm("sms");
  };

  // Zleć AI Sales OS-owi napisanie i wysyłkę maila (treść + wysyłka po stronie CRM-u).
  const sendViaSalesOs = async () => {
    if (!email) { toast("Brak adresu e-mail firmy — uzupełnij, by wysłać przez Sales OS."); return; }
    setOsSending(true);
    const ctx = intel?.analysis || lead.note || (lead.url ? undefined : "Firma bez strony www — oferujemy stronę + profil Google.");
    const r = await outreachViaSalesOs({ ...leadToOutreachInput(lead, ctx), email });
    setOsSending(false);
    toast(r.message);
    if (r.sent) {
      markContacted(lead.id);
      set({ status: lead.status === "new" || lead.status === "contacted" ? "offer" : lead.status, note: `${lead.note ? lead.note + " · " : ""}Mail przez Sales OS ${new Date().toLocaleDateString("pl-PL")}` });
    }
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
              onChange={(e) => {
                const status = e.target.value as LeadStatus;
                set({ status });
                toast(`✓ Status: ${STATUS.find((s) => s.id === status)?.label || status}`); // widoczne potwierdzenie
                // Lead z CRM-u → wypchnij zmianę z powrotem do lejka Sales OS (dwukierunkowo).
                if (lead.origin === "salesos") void pushLeadStatusToSalesOs({ ...lead, status }, status).then((r) => r && toast(r.message));
              }}
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
            {/* 🚫 Jeden ruch: zamknięte/nie kontaktować — status Odrzucony + wpis w dzienniku. Dedupe i tak nie pokaże go ponownie. */}
            {lead.status !== "lost" && (
              <button className="chip" title="Oznacz jako zamknięte — nie pokaże się ponownie w wyszukiwaniu" onClick={() => {
                set({ status: "lost", notes: appendLeadNote(lead.notes, "Zamknięte — nie kontaktować.", Date.now()) });
                toast("🚫 Oznaczono jako zamknięte — nie wróci w wynikach.");
              }}>🚫 Zamknięte</button>
            )}
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
            </div>
            {!email && !phone && (
              <div className="notice" style={{ marginTop: 8, fontSize: 12.5 }}>
                📵 Brak danych kontaktowych (e-mail i telefon). Kliknij <b>🗺 Mapy/opinie</b>, żeby znaleźć numer w Google, albo wejdź na stronę firmy.
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {phone && <button className="chip" onClick={() => window.open(`tel:${phone.replace(/\s/g, "")}`)}>📞 Zadzwoń</button>}
              {phone && <button className="chip" onClick={sendSms}>📱 SMS z zaczepką</button>}
              {lead.url && <button className="chip" onClick={() => safeOpenExternal(lead.url)}>🌐 Strona</button>}
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

          {/* 📞 Dziennik kontaktu — zapisz, co ustaliłeś po rozmowie (CRM) */}
          {(() => {
            const timeline = leadTimeline(lead);
            const saveNote = () => {
              const t = noteInput.trim();
              if (!t) { toast("Wpisz treść notatki."); return; }
              set({ notes: appendLeadNote(lead.notes, t, Date.now()) });
              setNoteInput("");
              toast("📝 Notatka zapisana w dzienniku kontaktu.");
            };
            return (
              <div className="journal-card" style={{ padding: "10px 12px", marginTop: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>📞 Dziennik kontaktu</div>
                <textarea
                  className="ta"
                  style={{ minHeight: 56 }}
                  value={noteInput}
                  placeholder="Co ustaliłeś po rozmowie? np. nie odebrał — oddzwonić jutro; albo: zamyka firmę — nie kontaktować."
                  onChange={(e) => setNoteInput(e.target.value)}
                />
                <button className="btn" style={{ marginTop: 6 }} onClick={saveNote}>💾 Zapisz notatkę</button>
                {timeline.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {timeline.slice(0, 12).map((n, i) => (
                      <div key={i} style={{ fontSize: 12.5, lineHeight: 1.45, borderLeft: "2px solid var(--line-strong)", paddingLeft: 8 }}>
                        <span className="muted" style={{ fontSize: 11 }}>{n.at ? new Date(n.at).toLocaleString("pl-PL") : "—"}</span>
                        <div>{n.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

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

          {/* Wysyłka przez Sales OS (CRM pisze treść i wysyła) — gdy poczta JARVIS-a niegotowa */}
          {!(intel?.email || lead.offer) && !canSendDirect() && salesOsConfigured() && email && (
            <button
              className="chip"
              style={{ marginTop: 14, borderColor: "var(--gold)", fontWeight: 600 }}
              onClick={sendViaSalesOs}
              disabled={osSending}
              title="AI Sales OS napisze i wyśle mail (treść + wysyłka w CRM-ie)"
            >
              {osSending ? "✉ Sales OS pisze i wysyła…" : "✉ Napisz i wyślij przez Sales OS"}
            </button>
          )}

          {/* E-mail */}
          {(intel?.email || lead.offer) && (
            <>
              <h3 style={{ marginTop: 14 }}>✉ Spersonalizowany e-mail</h3>
              <div className="journal-card">
                <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{intel?.email || lead.offer}</p>
                {/* 📬 Agent dostarczalności — ryzyko spamu + szybkie poprawki (Revenue OS) */}
                {(() => {
                  const txt = intel?.email || lead.offer || "";
                  const { subject, body } = splitOffer(txt, `Oferta dla ${lead.company}`, store.settings.emailSignature);
                  const d = scoreDeliverability(subject, body);
                  return (
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: d.risk === "low" ? "#39d98a" : d.risk === "medium" ? "var(--gold)" : "#ff6b6b" }}>📬 {deliverabilityLabel(d)}</span>
                      {d.fixes.length > 0 && <div className="muted" style={{ marginTop: 2 }}>Popraw: {d.fixes.slice(0, 2).join(" ")}</div>}
                    </div>
                  );
                })()}
                {/* ✍ Akcje AI kompozytora — przerób draft jednym dotknięciem (Email OS) */}
                <div className="chips" style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {COMPOSER_ACTIONS.map((a) => (
                    <button key={a.id} className="chip" disabled={composing !== ""} onClick={() => void runComposer(a.id)} title="Przerób treść maila przez AI">
                      {composing === a.id ? "…" : a.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {canSendDirect() && email && (
                    <button className="chip" style={{ borderColor: "var(--ok, #58e08a)" }} onClick={sendNow} disabled={sending}>
                      {sending ? "📨 Wysyłam…" : "📨 WYŚLIJ TERAZ"}
                    </button>
                  )}
                  {email ? (
                    <>
                      <button className="chip" onClick={() => sendVia("gmail")}>✉ Otwórz w Gmailu</button>
                      <button className="chip" onClick={() => sendVia("mail")}>📧 Otwórz w poczcie</button>
                    </>
                  ) : (
                    <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                      Brak e-maila tego leada — wysyłka mailowa niedostępna. Zadzwoń albo znajdź adres (🗺 Mapy/opinie).
                    </span>
                  )}
                  {salesOsConfigured() && email && (
                    <button className="chip" style={{ borderColor: "var(--gold)" }} onClick={sendViaSalesOs} disabled={osSending} title="AI Sales OS napisze i wyśle (treść + wysyłka w CRM-ie)">
                      {osSending ? "✉ Sales OS…" : "✉ Wyślij przez Sales OS"}
                    </button>
                  )}
                  {phone && <button className="chip" onClick={sendSms}>📱 SMS</button>}
                  <button className="chip" onClick={() => copyWithToast(intel?.email || lead.offer || "")}>📋 Kopiuj</button>
                </div>
                {awaitingConfirm && (
                  <div className="journal-card" style={{ marginTop: 8, padding: "8px 10px", borderLeft: "3px solid var(--gold)", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 13 }}>Czy {awaitingConfirm === "sms" ? "wysłałeś SMS" : "wysłałeś maila"}?</span>
                    <button className="chip" style={{ borderColor: "var(--ok, #58e08a)" }} onClick={() => confirmContact(awaitingConfirm)}>✓ Tak, wysłane</button>
                    <button className="chip" onClick={() => setAwaitingConfirm("")}>Jeszcze nie</button>
                  </div>
                )}
                {!canSendDirect() && email && (
                  <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                    💡 Chcesz wysyłać jednym kliknięciem, bez otwierania poczty? Na Windows: ⚙ → Poczta (adres + hasło aplikacji).
                    Na telefonie: ⚙ → Poczta (adres + hasło aplikacji) + ⚙ → Synchronizacja (adres backendu + token) — wtedy telefon wysyła w tle, bez Gmaila.
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
            <button className="btn" style={{ marginTop: 14 }} onClick={() => onWeb(buildGrowthContext(lead))}>
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
