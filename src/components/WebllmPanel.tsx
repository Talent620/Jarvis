import { useEffect, useRef, useState } from "react";
import type { Settings } from "../types";
import {
  WEBLLM_MODELS,
  WEBLLM_DEFAULT_MODEL,
  webllmSupported,
  chatLocal,
  onWebllmProgress,
} from "../lib/webllm";

// Panel mózgu on-device (WebLLM). Opcja z capability-check (WebGPU) + jasny stan pobierania.
export default function WebllmPanel({ s, set }: { s: Settings; set: (patch: Partial<Settings>) => void }) {
  const supported = webllmSupported();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [pct, setPct] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [err, setErr] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const off = onWebllmProgress((p, text) => {
      if (!mounted.current) return;
      setPct(p);
      setProgressText(text);
    });
    return () => { mounted.current = false; off(); };
  }, []);

  const model = s.webllmModel?.trim() || WEBLLM_DEFAULT_MODEL;

  async function warmup() {
    setBusy(true);
    setErr("");
    setReady(false);
    try {
      const out = await chatLocal(model, [{ role: "user", content: "Powiedz po polsku: gotowy." }], { timeoutMs: 600000 });
      if (!mounted.current) return;
      if (out == null) setErr("Nie udało się uruchomić modelu on-device (sprawdź wsparcie WebGPU/sieć przy pierwszym pobraniu).");
      else setReady(true);
    } catch (e) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span>
          🧩 Mózg on-device (WebLLM)
          <br />
          <span className="muted">
            Prawdziwy model językowy działający <b>w przeglądarce/APK na WebGPU</b> — bez serwera, bez klucza,
            offline po pobraniu. Dołącza do łańcucha jako lokalny model (i główny w Trybie Prywatnym).
            {supported ? "" : " ⚠ To urządzenie nie ma WebGPU — JARVIS użyje chmury."}
          </span>
        </span>
        <div
          className={`switch ${s.webllmEnabled ? "on" : ""}`}
          onClick={() => set({ webllmEnabled: !s.webllmEnabled })}
        />
      </div>

      {s.webllmEnabled && supported && (
        <>
          <label className="muted" style={{ fontSize: 13 }}>Model on-device</label>
          <select
            className="input"
            value={model}
            onChange={(e) => { set({ webllmModel: e.target.value }); setReady(false); setPct(0); }}
          >
            {WEBLLM_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>

          <button className="btn" disabled={busy} onClick={warmup}>
            {busy ? "⏳ Pobieram/rozgrzewam…" : ready ? "✅ Model gotowy — sprawdź ponownie" : "⬇ Pobierz / rozgrzej model"}
          </button>

          {busy && (
            <div style={{ margin: "2px 0" }}>
              <div style={{ height: 6, background: "rgba(255,255,255,.1)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent,#3da9fc)", transition: "width .2s" }} />
              </div>
              <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>{pct}% · {progressText || "przygotowuję…"}</p>
            </div>
          )}
          {ready && !busy && <p className="muted" style={{ fontSize: 12 }}>✅ Model załadowany i gotowy do rozmowy on-device.</p>}
          {err && <p className="muted" style={{ fontSize: 12, color: "var(--danger,#ff6b6b)" }}>⚠ {err}</p>}
        </>
      )}
    </div>
  );
}
