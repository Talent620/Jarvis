import { useEffect, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { toast } from "../lib/toast";
import { store } from "../lib/store";
import { guardian, guardianDiagnose, guardianAdvise, guardianExecute, guardianPlan, isOutgoingCommand, healthScore, recommendActions, GUARDIAN_CAPABILITIES, type GuardianStatus, type GuardianActionResult, type GuardianActionKey } from "../lib/guardian";
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
  // Podgląd „co zaraz zrobię" + polecenie czekające na potwierdzenie (działania wychodzące).
  const [preview, setPreview] = useState<{ cmd: string; plan: string } | null>(null);
  const [proactive, setProactive] = useState(store.settings.guardianProactive);
  const [autopilot, setAutopilot] = useState(store.settings.guardianAutopilot);

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

  // Dyrygent: jedno kliknięcie zalecenia → odpowiednia, sprawdzona akcja Strażnika.
  const runRec = (key: GuardianActionKey) => {
    if (key === "fixAll") return void run(() => guardian.fixAll((m) => setMsg(`🩹 ${m}`)));
    if (key === "connectServers") return void run(() => guardian.connectServers((m) => setMsg(`🔗 ${m}`)));
    if (key === "smarter") return void run(() => guardian.smarter((m) => setMsg(`🧠 ${m}`)));
    if (key === "faster") return void run(() => guardian.faster());
    if (key === "fixVoice") return void run(() => guardian.fixVoice());
    if (key === "update") return void doUpdate();
  };

  const ask = async () => {
    if (busy || !q.trim()) return;
    setBusy(true); setExec(null); setPreview(null); setAdvice("⏳ Strażnik analizuje…");
    try { setAdvice(await guardianAdvise(q.trim())); }
    catch { setAdvice("Nie udało się uzyskać porady — sprawdź, czy mózg AI odpowiada."); }
    finally { setBusy(false); }
  };

  // Realne wykonanie: pełny mózg JARVISA + narzędzia (zadania, e-mail, kalendarz, smart home, web, PC…).
  const realExecute = async (cmd: string) => {
    setBusy(true); setAdvice(""); setExec(null); setPreview(null); setMsg("⚙ Wykonuję polecenie…");
    try { setExec(await guardianExecute(cmd)); setMsg(""); }
    catch { setMsg("⚠ Nie udało się wykonać — sprawdź, czy mózg AI odpowiada."); }
    finally { setBusy(false); }
  };

  // WYKONAJ z bramką bezpieczeństwa: polecenia WYCHODZĄCE/nieodwracalne (mail, SMS, telefon,
  // pieniądze, smart home…) najpierw pokazują podgląd „co zaraz zrobię" i czekają na potwierdzenie.
  // Bezpieczne (np. dodanie zadania) lecą od ręki.
  const doExecute = async () => {
    if (busy || !q.trim()) return;
    const cmd = q.trim();
    if (!isOutgoingCommand(cmd)) { await realExecute(cmd); return; }
    setBusy(true); setAdvice(""); setExec(null); setPreview(null); setMsg("🔎 Przygotowuję podgląd działania…");
    try { setPreview({ cmd, plan: await guardianPlan(cmd) }); setMsg(""); }
    catch { setPreview({ cmd, plan: "(Nie udało się przygotować podglądu — potwierdź, jeśli na pewno chcesz wykonać.)" }); setMsg(""); }
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

          {/* Kondycja JARVISA — jedna liczba (dyrygent na pierwszy rzut oka) */}
          {status && (() => {
            const h = healthScore(status);
            const col = h.grade === "A" ? "#39d98a" : h.grade === "B" ? "#7ec8ff" : h.grade === "C" ? "var(--gold)" : "#ff6b6b";
            return (
              <div className="journal-card" style={{ padding: "10px 12px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 30, fontWeight: 800, color: col, lineHeight: 1, minWidth: 54, textAlign: "center" }}>{h.score}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  <b>Kondycja JARVISA: {h.label}</b> (ocena {h.grade})<br />
                  <span className="muted" style={{ fontSize: 12 }}>Strażnik czuwa i dyryguje działaniem.</span>
                </div>
              </div>
            );
          })()}

          {/* Zalecenia dyrygenta — priorytetowe akcje jednym kliknięciem */}
          {status && recommendActions(status).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>🧭 Zalecane przez Strażnika</div>
              {recommendActions(status).map((r) => (
                <button key={r.key} className="btn" style={{ width: "100%", textAlign: "left", marginTop: 6, padding: "8px 12px" }} disabled={busy} onClick={() => runRec(r.key)}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                  <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{r.why}</div>
                </button>
              ))}
            </div>
          )}

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

          {/* Autopilot — dyrygent sam naprawia (tylko bezpieczne, odwracalne akcje) */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6, cursor: proactive ? "pointer" : "not-allowed", opacity: proactive ? 1 : 0.5 }}>
            <input
              type="checkbox"
              checked={autopilot}
              disabled={!proactive}
              onChange={(e) => { setAutopilot(e.target.checked); store.setSettings({ guardianAutopilot: e.target.checked }); }}
            />
            🤖 Autopilot — sam naprawia bezpieczne rzeczy (łączy serwery, wybiera mózg, poprawia ustawienia). Nigdy nie wysyła nic na zewnątrz.
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
          {/* Podgląd „co zaraz zrobię" — potwierdzenie przed działaniem wychodzącym */}
          {preview && (
            <div className="journal-card" style={{ padding: "10px 12px", marginTop: 8, border: "1px solid var(--gold)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>👁 Zanim wykonam — co zaraz zrobię:</div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{preview.plan}</div>
              <div className="chips" style={{ marginTop: 10 }}>
                <button className="btn primary" style={{ flex: 1, marginTop: 0 }} disabled={busy} onClick={() => void realExecute(preview.cmd)}>✅ Potwierdź i wykonaj</button>
                <button className="btn" style={{ flex: 1, marginTop: 0 }} disabled={busy} onClick={() => { setPreview(null); setMsg("Anulowano — nic nie wykonano."); }}>✖ Anuluj</button>
              </div>
            </div>
          )}
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
