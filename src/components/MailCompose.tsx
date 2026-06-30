import { useState, useEffect } from "react";
import { useEscape } from "../hooks/useEscape";
import { useDirtyClose } from "../hooks/useDirtyClose";
import { store } from "../lib/store";
import { toast } from "../lib/toast";
import { sendOfferEmail, canSendDirect, isValidEmail, mailReadiness } from "../lib/mailer";
import { gmailComposeUrl, mailtoUrl, appendSignature, safeOpenExternal } from "../lib/glinks";
import { scoreDeliverability, deliverabilityLabel } from "../lib/emailDeliverability";
import { applyComposerAction, COMPOSER_ACTIONS, type ComposerAction } from "../lib/emailComposer";
import { listSignatures, addSignature, removeSignature, useSignature as selectSignature, seedSignatures, type Signature } from "../lib/signatures";

// ✉ Ręczna wysyłka e-maila z poziomu JARVIS-a (PHASE 2/6 — Manual Send). Pełna kontrola: wpisujesz
// adresata, temat, treść — wysyłasz jednym przyciskiem przez skonfigurowany kanał (SMTP/Gmail) albo
// otwierasz w Gmailu/poczcie. Z badge dostarczalności i akcjami AI kompozytora. Nieinwazyjne (nowy panel).
export default function MailCompose({ onClose, presetTo = "", presetSubject = "", presetBody = "" }: { onClose: () => void; presetTo?: string; presetSubject?: string; presetBody?: string }) {
  const [to, setTo] = useState(presetTo);
  const [subject, setSubject] = useState(presetSubject);
  const [body, setBody] = useState(presetBody);
  // Ochrona niezapisanego maila: zmiany względem presetów I jakaś treść = „brudny" → zamknięcie
  // pyta. Po wysłaniu (pola czyszczone) nie jest brudny, więc nie pyta niepotrzebnie.
  const dirty = (to !== presetTo || subject !== presetSubject || body !== presetBody) &&
    (to.trim() !== "" || subject.trim() !== "" || body.trim() !== "");
  const close = useDirtyClose(dirty, onClose, "Masz niewysłany e-mail. Zamknąć i odrzucić wersję roboczą?");
  useEscape(close);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState<ComposerAction | "">("");
  const [sigs, setSigs] = useState<Signature[]>([]);
  const [activeBody, setActiveBody] = useState(store.settings.emailSignature || "");
  const [manage, setManage] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBody, setNewBody] = useState("");

  // Zasiej istniejący podpis do listy i wczytaj bibliotekę (nieinwazyjnie).
  useEffect(() => { seedSignatures(); setSigs(listSignatures()); setActiveBody(store.settings.emailSignature || ""); }, []);
  const refreshSigs = () => { setSigs(listSignatures()); setActiveBody(store.settings.emailSignature || ""); };

  const pickSignature = (id: string) => { selectSignature(id); refreshSigs(); };
  const saveSignature = () => {
    if (!newBody.trim()) { toast("Wpisz treść podpisu."); return; }
    const s = addSignature(newName, newBody.trim());
    selectSignature(s.id);
    setNewName(""); setNewBody(""); setManage(false); refreshSigs();
    toast("✅ Podpis zapisany i ustawiony jako aktywny");
  };
  const deleteSignature = (id: string) => { removeSignature(id); refreshSigs(); };

  const direct = canSendDirect();
  const finalBody = () => appendSignature(body, store.settings.emailSignature);
  const d = scoreDeliverability(subject, body);

  const runComposer = async (action: ComposerAction) => {
    if (!body.trim()) { toast("Najpierw wpisz treść."); return; }
    setComposing(action);
    setBody(await applyComposerAction(body, action));
    setComposing("");
  };

  const sendNow = async () => {
    if (!isValidEmail(to)) { toast("Podaj poprawny adres e-mail."); return; }
    if (!subject.trim() && !body.trim()) { toast("Wpisz temat lub treść."); return; }
    setBusy(true);
    const r = await sendOfferEmail(to.trim(), subject.trim() || "(bez tematu)", finalBody());
    setBusy(false);
    if (r.ok) { toast(`✅ Wysłano (${r.via}) — zapisano w 📤 Wysłanych`); setTo(""); setSubject(""); setBody(""); }
    else toast(`⚠ ${r.error}`);
  };

  const openGmail = () => safeOpenExternal(gmailComposeUrl(to.trim(), subject.trim(), finalBody()));
  const openMail = () => safeOpenExternal(mailtoUrl(to.trim(), subject.trim(), finalBody()));

  return (
    <div className="sheet" onClick={close}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>✉ Wyślij e-mail</h2>
        </div>
        <div className="panel-body">
          <div className="field"><label>Do (adres e-mail)</label>
            <input value={to} placeholder="firma@domena.pl" onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field"><label>Temat</label>
            <input value={subject} placeholder="Temat wiadomości" onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="field"><label>Treść</label>
            <textarea className="ta" style={{ minHeight: 140 }} value={body} placeholder="Treść e-maila… (podpis dokleję automatycznie)" onChange={(e) => setBody(e.target.value)} />
          </div>

          {/* 📬 Dostarczalność + ✍ akcje AI kompozytora */}
          {body.trim() && (
            <>
              <div style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: d.risk === "low" ? "#39d98a" : d.risk === "medium" ? "var(--gold)" : "#ff6b6b" }}>📬 {deliverabilityLabel(d)}</span>
                {d.fixes.length > 0 && <div className="muted" style={{ marginTop: 2 }}>Popraw: {d.fixes.slice(0, 2).join(" ")}</div>}
              </div>
              <div className="chips" style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {COMPOSER_ACTIONS.map((a) => (
                  <button key={a.id} className="chip" disabled={composing !== ""} onClick={() => void runComposer(a.id)}>
                    {composing === a.id ? "…" : a.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ✍ Podpisy — wybór aktywnego przed wysyłką + zarządzanie (PHASE 3) */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>✍ Podpis (aktywny dokleję do wysyłki)</label>
              <button className="chip" onClick={() => setManage((m) => !m)}>{manage ? "Zwiń" : "➕ Nowy"}</button>
            </div>
            {sigs.length > 0 && (
              <div className="chips" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {sigs.map((s) => {
                  const isActive = s.body === activeBody;
                  return (
                    <span key={s.id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, borderColor: isActive ? "var(--gold)" : undefined, color: isActive ? "var(--gold)" : undefined }}>
                      <button style={{ all: "unset", cursor: "pointer" }} onClick={() => pickSignature(s.id)} title={s.body}>{isActive ? "✓ " : ""}{s.name}</button>
                      <button style={{ all: "unset", cursor: "pointer", opacity: 0.6 }} onClick={() => deleteSignature(s.id)} title="Usuń">✕</button>
                    </span>
                  );
                })}
              </div>
            )}
            {manage && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <input value={newName} placeholder="Nazwa (np. Firmowy)" onChange={(e) => setNewName(e.target.value)} />
                <textarea className="ta" style={{ minHeight: 60 }} value={newBody} placeholder="Treść podpisu…" onChange={(e) => setNewBody(e.target.value)} />
                <button className="btn" onClick={saveSignature}>💾 Zapisz podpis</button>
              </div>
            )}
          </div>
        </div>
        <div className="panel-foot">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {direct && (
              <button className="btn primary" style={{ flex: 1, minWidth: 140 }} onClick={() => void sendNow()} disabled={busy}>
                {busy ? "📨 Wysyłam…" : "📨 Wyślij teraz"}
              </button>
            )}
            <button className="btn" style={{ flex: 1, minWidth: 120 }} onClick={openGmail}>✉ Otwórz w Gmailu</button>
            <button className="btn" style={{ flex: 1, minWidth: 120 }} onClick={openMail}>📧 Poczta</button>
          </div>
          {!direct && (
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              💡 Wysyłka jednym kliknięciem (bez otwierania poczty) — {mailReadiness().reason}
            </p>
          )}
          <button className="btn" style={{ marginTop: 8 }} onClick={close}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
