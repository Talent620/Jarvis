import { useEffect, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { toast } from "../lib/toast";
import { store } from "../lib/store";
import { guardian, guardianDiagnose, guardianAdvise, guardianExecute, GUARDIAN_CAPABILITIES, type GuardianStatus, type GuardianActionResult } from "../lib/guardian";
import { checkForUpdate, applyUpdate } from "../lib/updater";

// 🛡 Strażnik JARVISA — autonomiczny pomocnik z głównego menu: diagnozuje, naprawia,
// przyspiesza/ulepsza/odcenzurowuje, łączy serwery i doradza po polsku. Jeden ekran „od wszystkiego".
export default function Guardian({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [status, setStatus] = useState<GuardianStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [advice, setAdvice] = useState("");
  const [exec, setExec] = useState<{ text: string; tools: string[] } | null>(null);
  const [proactive, setProactive] = useState(store.settings.guardianProactive);

  const refresh = async () => {
    setBusy(true); setMsg("Sprawdzam stan JARVISA…");
    try { setStatus(await guardianDiagnose()); setMsg(""); }
    catch { setMsg("Nie udało się odczytać stanu."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const run = async (fn: () => Promise<GuardianActionResult> | GuardianActionResult) => {
    if (busy) return;
    setBusy(true); setAdvice("");
    try {
      const r = await fn();
      setMsg(r.message);
      toast(r.message);
      await refresh();
    } catch {
      setMsg("⚠ Coś poszło nie tak — spróbuj ponownie.");
      setBusy(false);
    }
  };

  const doUpdate = async () => {
    if (busy) return;
    setBusy(true); setAdvice(""); setMsg("Sprawdzam aktualizacje JARVISA…");
    try {
      const r = await checkForUpdate();
      if ("error" in r) { setMsg(`❌ ${r.error}`); return; }
      if (!r.newer) { setMsg(`✅ Masz najnowszą wersję (${r.current}).`); return; }
      setMsg(`🎉 Jest nowsza wersja (${r.latest}) — ${r.platform === "web" ? "odświeżam…" : "pobieram, kliknij plik, by zainstalować."}`);
      await applyUpdate(r);
    } catch {
      setMsg("⚠ Nie udało się sprawdzić aktualizacji.");
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (busy || !q.trim()) return;
    setBusy(true); setExec(null); setAdvice("⏳ Strażnik analizuje…");
    try { setAdvice(await guardianAdvise(q.trim())); }
    catch { setAdvice("Nie udało się uzyskać porady — sprawdź, czy mózg AI odpowiada."); }
    finally { setBusy(false); }
  };

  // WYKONAJ: pełny mózg JARVISA + narzędzia (zadania, e-mail, kalendarz, smart home, web, PC…).
  // Akcje ryzykowne i tak przechodzą przez zgody aplikacji; przelewów Strażnik sam nie zrobi.
  const doExecute = async () => {
    if (busy || !q.trim()) return;
    setBusy(true); setAdvice(""); setExec(null); setMsg("⚙ Wykonuję polecenie…");
    try { setExec(await guardianExecute(q.trim())); setMsg(""); }
    catch { setMsg("⚠ Nie udało się wykonać — sprawdź, czy mózg AI odpowiada."); }
    finally { setBusy(false); }
  };

  const dot = (s: "ok" | "off" | "empty") => (s === "ok" ? "🟢" : s === "empty" ? "🟡" : "🔴");

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><div className="grabber" /><h2>🛡 Strażnik JARVISA</h2></div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Autonomiczny opiekun płynności i działania. Naprawia, przyspiesza, ulepsza, łączy serwery i doradza.
          </p>

          {/* Status */}
          {status && (
            <div className="journal-card" style={{ padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                🧠 Mózg: <b>{status.brain}</b><br />
                {dot(status.ollama)} Serwer Ollama {status.ollama === "ok" ? `(${status.ollamaModels} model(i))` : status.ollama === "empty" ? "(bez modeli)" : "(brak)"}<br />
                {dot(status.sd)} Serwer obrazów (SD)<br />
                ⚡ Szybkość: {status.speedLabel}<br />
                🔊 Głos: {status.voiceLabel}
              </div>
              {status.issues.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {status.issues.map((it, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--gold)" }}>⚠ {it}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Główna akcja */}
          <button className="btn primary" style={{ width: "100%", marginBottom: 8 }} disabled={busy} onClick={() => void run(() => guardian.fixAll((m) => setMsg(`🩹 ${m}`)))}>
            🩹 Napraw wszystko (i wybierz działający mózg)
          </button>

          {/* Szybkie tryby */}
          <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
            <button className="chip" disabled={busy} onClick={() => void run(() => guardian.faster())}>⚡ Szybciej</button>
            <button className="chip" disabled={busy} onClick={() => void run(() => guardian.smarter((m) => setMsg(`🧠 ${m}`)))}>🧠 Mądrzej</button>
            <button className="chip" disabled={busy} onClick={() => void run(() => guardian.uncensored((m) => setMsg(`🔓 ${m}`)))}>🔓 Bez cenzury</button>
            <button className="chip" disabled={busy} onClick={() => void run(() => guardian.connectServers((m) => setMsg(`🔗 ${m}`)))}>🔗 Połącz serwery</button>
            <button className="chip" disabled={busy} onClick={() => void run(() => guardian.fixVoice())}>🇵🇱 Napraw głos</button>
            <button className="chip" disabled={busy} onClick={() => void doUpdate()}>⬆ Aktualizuj</button>
          </div>

          {msg && <p className="muted" style={{ fontSize: 12, whiteSpace: "pre-line" }}>{msg}</p>}

          {/* Tryb proaktywny */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={proactive}
              onChange={(e) => { setProactive(e.target.checked); store.setSettings({ guardianProactive: e.target.checked }); }}
            />
            🔔 Tryb proaktywny — Strażnik sam co jakiś czas sprawdza i podpowiada „Napraw", gdy coś nie gra.
          </label>

          {/* Doradca + Wykonanie — Strażnik od wszystkiego */}
          <h3 style={{ marginTop: 14 }}>💬 Zapytaj lub zleć Strażnikowi</h3>
          <input
            value={q}
            placeholder="np. dodaj zadanie na jutro, napisz maila do Jana, jaka pogoda, włącz światło…"
            disabled={busy}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void doExecute(); }}
            style={{ width: "100%" }}
          />
          <div className="chips" style={{ marginTop: 8 }}>
            <button className="btn primary" style={{ flex: 1, marginTop: 0 }} disabled={busy || !q.trim()} onClick={() => void doExecute()}>⚡ Wykonaj</button>
            <button className="btn" style={{ flex: 1, marginTop: 0 }} disabled={busy || !q.trim()} onClick={() => void ask()}>💡 Doradź</button>
          </div>
          {exec && (
            <div className="journal-card" style={{ padding: "10px 12px", marginTop: 8 }}>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{exec.text}</div>
              {exec.tools.length > 0 && (
                <div className="tools" style={{ marginTop: 6 }}>
                  {exec.tools.map((t) => (<span className="tag" key={t}>{t}</span>))}
                </div>
              )}
            </div>
          )}
          {advice && <p className="muted" style={{ fontSize: 13, whiteSpace: "pre-wrap", marginTop: 8 }}>{advice}</p>}

          {/* Katalog możliwości — pełnia mocy (z jasną granicą przy pieniądzach) */}
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>🦾 Co potrafię (pełna lista)</summary>
            <div style={{ marginTop: 8 }}>
              {GUARDIAN_CAPABILITIES.map((g) => (
                <div key={g.group} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{g.group}</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                    {g.items.map((it) => (<li key={it}>{it}</li>))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </div>
        <div className="panel-foot" style={{ display: "flex", gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={refresh}>{busy ? "Pracuję…" : "🔄 Odśwież"}</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
