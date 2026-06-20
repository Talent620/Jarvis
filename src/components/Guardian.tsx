import { useEffect, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { toast } from "../lib/toast";
import { store } from "../lib/store";
import { guardian, guardianAdvise, guardianExecute, guardianPlan, isOutgoingCommand, GUARDIAN_CAPABILITIES, type GuardianActionResult, type GuardianActionKey } from "../lib/guardian";
import { guardianScan, type GuardianScan, type AgentReport, type AgentState } from "../lib/guardianAgents";
import { checkForUpdate, applyUpdate } from "../lib/updater";

// 🛡 Strażnik JARVISA — centralny panel dowodzenia. Guardian Core skanuje cały ekosystem przez
// podagentów (AI, wydajność, głos, obrazy, integracje, aktualizacje), wystawia ocenę zdrowia 0–100,
// rekomendacje „jednym kliknięciem", tryb doradcy/wykonawcy i autopilota. Jeden ekran „od wszystkiego".
const STATE_DOT: Record<AgentState, string> = { ok: "🟢", warn: "🟡", problem: "🔴", off: "⚪" };
const FIND_COL: Record<"ok" | "warn" | "problem", string> = { ok: "var(--text-dim)", warn: "var(--gold)", problem: "#ff6b6b" };

export default function Guardian({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [scan, setScan] = useState<GuardianScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [advice, setAdvice] = useState("");
  const [exec, setExec] = useState<{ text: string; tools: string[] } | null>(null);
  // Podgląd „co zaraz zrobię" + polecenie czekające na potwierdzenie (działania wychodzące).
  const [preview, setPreview] = useState<{ cmd: string; plan: string } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [proactive, setProactive] = useState(store.settings.guardianProactive);
  const [autopilot, setAutopilot] = useState(store.settings.guardianAutopilot);

  const refresh = async () => {
    setBusy(true); setMsg("Skanuję ekosystem JARVISA…");
    try { setScan(await guardianScan({ checkUpdate: true })); setMsg(""); }
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
  const runRec = (key?: GuardianActionKey) => {
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
  const doExecute = async () => {
    if (busy || !q.trim()) return;
    const cmd = q.trim();
    if (!isOutgoingCommand(cmd)) { await realExecute(cmd); return; }
    setBusy(true); setAdvice(""); setExec(null); setPreview(null); setMsg("🔎 Przygotowuję podgląd działania…");
    try { setPreview({ cmd, plan: await guardianPlan(cmd) }); setMsg(""); }
    catch { setPreview({ cmd, plan: "(Nie udało się przygotować podglądu — potwierdź, jeśli na pewno chcesz wykonać.)" }); setMsg(""); }
    finally { setBusy(false); }
  };

  const healthCol = (g: string) => (g === "A" ? "#39d98a" : g === "B" ? "#7ec8ff" : g === "C" ? "var(--gold)" : "#ff6b6b");

  // Karta podagenta: stan, wynik, rozwijane ustalenia + rekomendacje.
  const AgentCard = (a: AgentReport) => {
    const isOpen = open[a.id] ?? a.state !== "ok"; // problemy rozwinięte domyślnie
    return (
      <div key={a.id} className="journal-card" style={{ padding: "8px 10px", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setOpen((o) => ({ ...o, [a.id]: !isOpen }))}>
          <span>{STATE_DOT[a.state]}</span>
          <span style={{ fontSize: 18 }}>{a.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{a.name}</span>
          <span className="muted" style={{ fontSize: 12 }}>{a.summary}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: healthCol(a.score >= 85 ? "A" : a.score >= 65 ? "B" : a.score >= 40 ? "C" : "D"), minWidth: 30, textAlign: "right" }}>{a.score}</span>
        </div>
        {isOpen && (
          <div style={{ marginTop: 6 }}>
            {a.findings.map((f, i) => (
              <div key={i} style={{ fontSize: 12, color: FIND_COL[f.level], lineHeight: 1.6 }}>
                {f.level === "problem" ? "🔴" : f.level === "warn" ? "⚠" : "•"} {f.text}
              </div>
            ))}
            {a.recs.length > 0 && (
              <div className="chips" style={{ flexWrap: "wrap", marginTop: 6 }}>
                {a.recs.map((r, i) => r.key
                  ? <button key={i} className="chip" disabled={busy} title={r.why} onClick={() => runRec(r.key)}>{r.label}</button>
                  : <span key={i} className="muted" style={{ fontSize: 11 }}>💡 {r.why}</span>)}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><div className="grabber" /><h2>🛡 Strażnik JARVISA</h2></div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Centralny panel dowodzenia: administrator, architekt AI, opiekun, diagnostyka i automatyzacja w jednym.
          </p>

          {/* 📊 Health Agent — ocena zdrowia całego systemu (0–100) */}
          {scan && (
            <div className="journal-card" style={{ padding: "10px 12px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: healthCol(scan.health.grade), lineHeight: 1, minWidth: 58, textAlign: "center" }}>{scan.health.score}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <b>Stan JARVISA: {scan.health.label}</b> (ocena {scan.health.grade})<br />
                <span className="muted" style={{ fontSize: 12 }}>Guardian Core dyryguje {scan.reports.length} agentami i czuwa nad całością.</span>
              </div>
            </div>
          )}

          {/* 🩹 Napraw wszystko — główna akcja naprawcza */}
          <button className="btn primary" style={{ width: "100%", marginBottom: 8 }} disabled={busy} onClick={() => void run(() => guardian.fixAll((m) => setMsg(`🩹 ${m}`)))}>
            🩹 Napraw wszystko (wykryj serwery i wybierz działający mózg)
          </button>

          {/* 🧭 Najważniejsze rekomendacje (zagregowane przez Guardian Core) */}
          {scan && scan.recs.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>🧭 Rekomendacje Strażnika</div>
              {scan.recs.slice(0, 4).map((r, i) => (
                <button key={i} className="btn" style={{ width: "100%", textAlign: "left", marginTop: 6, padding: "8px 12px", opacity: r.key ? 1 : 0.85 }} disabled={busy || !r.key} onClick={() => runRec(r.key)}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                  <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{r.why}</div>
                </button>
              ))}
            </div>
          )}

          {/* 🛰 Panel agentów — stan każdej domeny */}
          {scan && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>🛰 Agenci systemu</div>
              {scan.reports.map((a) => AgentCard(a))}
            </div>
          )}

          {/* Szybkie tryby (ręcznie) */}
          <details style={{ marginBottom: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>⚙ Tryby ręczne</summary>
            <div className="chips" style={{ flexWrap: "wrap", marginTop: 8 }}>
              <button className="chip" disabled={busy} onClick={() => void run(() => guardian.faster())}>⚡ Szybciej</button>
              <button className="chip" disabled={busy} onClick={() => void run(() => guardian.smarter((m) => setMsg(`🧠 ${m}`)))}>🧠 Mądrzej</button>
              <button className="chip" disabled={busy} onClick={() => void run(() => guardian.uncensored((m) => setMsg(`🔓 ${m}`)))}>🔓 Bez cenzury</button>
              <button className="chip" disabled={busy} onClick={() => void run(() => guardian.connectServers((m) => setMsg(`🔗 ${m}`)))}>🔗 Połącz serwery</button>
              <button className="chip" disabled={busy} onClick={() => void run(() => guardian.fixVoice())}>🇵🇱 Napraw głos</button>
              <button className="chip" disabled={busy} onClick={() => void doUpdate()}>⬆ Aktualizuj</button>
            </div>
          </details>

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
            placeholder="np. jak przyspieszyć JARVISA, jaki model wybrać, dodaj zadanie, napisz maila…"
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
          <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={refresh}>{busy ? "Pracuję…" : "🔄 Skanuj ponownie"}</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
