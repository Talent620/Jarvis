import { useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { copyWithToast, toast } from "../lib/toast";
import { dailyValuation, plnRange } from "../lib/projectValue";
import Guide from "./Guide";
import {
  verifyOwnerPhone,
  loadAdminConfig,
  saveAdminConfig,
  listLicenses,
  issueLicense,
  revokeLicense,
  resetDevices,
  type AdminConfig,
  type LicenseRow,
} from "../lib/admin";

// Panel administratora w wersji premium — wewnątrz JARVIS-a. Odblokowanie
// numerem właściciela (dostęp awaryjny), sekrety szyfrowane lokalnie.
export default function AdminPanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [phone, setPhone] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [cfg, setCfg] = useState<AdminConfig>({ workerUrl: "", adminToken: "" });
  const [tab, setTab] = useState<"licenses" | "keys" | "value">("licenses");
  const [rows, setRows] = useState<LicenseRow[] | null>(null);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ name: "", days: "", limit: "1" });
  const [newKey, setNewKey] = useState("");

  const unlock = async () => {
    if (!(await verifyOwnerPhone(phone))) {
      setMsg("❌ Nieprawidłowy numer właściciela.");
      return;
    }
    const c = await loadAdminConfig(phone);
    setCfg(c || { workerUrl: "", adminToken: "" });
    setUnlocked(true);
    setMsg("");
    if (c?.adminToken) void refresh(c);
  };

  const persist = async (next: AdminConfig) => {
    setCfg(next);
    await saveAdminConfig(phone, next);
  };

  const refresh = async (c = cfg) => {
    setMsg("Pobieram licencje…");
    const r = await listLicenses(c);
    setMsg(r.error || "");
    setRows(r.licenses || null);
  };

  const issue = async () => {
    if (!form.name.trim()) {
      toast("Podaj imię/firmę klienta.");
      return;
    }
    setMsg("Generuję klucz…");
    const r = await issueLicense(cfg, { name: form.name.trim(), days: form.days ? Number(form.days) : 0, deviceLimit: Number(form.limit) || 1 });
    if (r.error) {
      setMsg(`❌ ${r.error}`);
      return;
    }
    setNewKey(r.key || "");
    setMsg("✅ Klucz wygenerowany — skopiuj i wyślij klientowi.");
    setForm({ name: "", days: "", limit: "1" });
    void refresh();
  };

  // --- Ekran odblokowania ---
  if (!unlocked) {
    return (
      <div className="sheet" onClick={onClose}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <div className="panel-head">
            <div className="grabber" />
            <h2>🔐 Panel administratora</h2>
          </div>
          <div className="panel-body">
            <p className="muted">
              Dostęp tylko dla właściciela. Odblokuj swoim numerem telefonu (weryfikacja awaryjna).
              Twoje sekrety są szyfrowane lokalnie (AES-256).
            </p>
            <div className="field" style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                inputMode="numeric"
                value={phone}
                placeholder="Numer właściciela…"
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && unlock()}
                style={{ flex: 1 }}
              />
              <button className="btn primary" style={{ width: "auto", marginTop: 0 }} onClick={unlock} disabled={!phone.trim()}>
                Odblokuj
              </button>
            </div>
            {msg && <p className="muted">{msg}</p>}
          </div>
          <div className="panel-foot">
            <button className="btn" onClick={onClose}>Zamknij</button>
          </div>
        </div>
      </div>
    );
  }

  // --- Panel właściwy ---
  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🔐 Panel administratora</h2>
          <div className="chips" style={{ marginTop: 10 }}>
            <button className={`chip ${tab === "licenses" ? "on" : ""}`} onClick={() => setTab("licenses")}>📋 Licencje</button>
            <button className={`chip ${tab === "keys" ? "on" : ""}`} onClick={() => setTab("keys")}>🗝 Moje klucze</button>
            <button className={`chip ${tab === "value" ? "on" : ""}`} onClick={() => setTab("value")}>💎 Wycena</button>
          </div>
        </div>
        <div className="panel-body">
          {tab === "keys" && (
            <>
              <Guide title="ℹ Co tu wpisać" open>
                <p><b>Adres serwera</b> — Twój Cloudflare Worker, np. <i>https://jarvis-bff.twojekonto.workers.dev</i></p>
                <p><b>Token administratora</b> — sekret <b>ADMIN_TOKEN</b> ustawiony w Workerze. To Twój główny klucz do zarządzania licencjami.</p>
                <p>Sekrety zapisują się <b>zaszyfrowane</b> Twoim numerem — bez niego nikt ich nie odczyta.</p>
              </Guide>
              <div className="field">
                <label>Adres serwera licencji</label>
                <input value={cfg.workerUrl} placeholder="https://…workers.dev" onChange={(e) => setCfg({ ...cfg, workerUrl: e.target.value })} />
              </div>
              <div className="field">
                <label>Token administratora (ADMIN_TOKEN)</label>
                <input type="password" value={cfg.adminToken} placeholder="sekret admina" onChange={(e) => setCfg({ ...cfg, adminToken: e.target.value })} />
              </div>
              <div className="field">
                <label>Notatki (opcjonalnie — np. klucz prywatny, dane kont)</label>
                <textarea className="ta" value={cfg.notes || ""} onChange={(e) => setCfg({ ...cfg, notes: e.target.value })} placeholder="Twoje prywatne notatki / klucze — zaszyfrowane" />
              </div>
              <button className="btn primary" onClick={async () => { await persist(cfg); toast("Zapisano (zaszyfrowane) ✓"); }}>💾 Zapisz sekrety</button>
              <button className="btn" style={{ marginTop: 8 }} onClick={() => refresh()}>🔌 Sprawdź połączenie z serwerem</button>
              {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
            </>
          )}

          {tab === "value" && (() => {
            const v = dailyValuation();
            const row = (label: string, val: string, hint?: string) => (
              <div className="status-row" style={{ alignItems: "flex-start" }}>
                <div className="status-main">
                  <div className="status-title">{label}</div>
                  {hint && <div className="status-detail">{hint}</div>}
                </div>
                <strong style={{ fontSize: 14, whiteSpace: "nowrap", textAlign: "right" }}>{val}</strong>
              </div>
            );
            return (
              <>
                <h3 style={{ marginTop: 0 }}>💎 Wycena JARVISA</h3>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                  Liczona z realnych metryk kodu. Odświeża się <b>raz dziennie</b> (dziś: {v.day}).
                </p>
                {row("Rozmiar kodu", `${v.loc.toLocaleString("pl-PL")} linii`, `${v.modules} modułów · ${v.components} ekranów · ${v.tests} plików testów`)}
                {row("Czas budowy (1 osoba)", `~${v.months} mies.`, `≈ ${v.hours.toLocaleString("pl-PL")} godzin pracy`)}
                {row("Koszt odtworzenia", plnRange(v.replMinPln, v.replMaxPln), "ile kosztowałoby zbudowanie tego od zera (stawki PL)")}
                {row("💰 Realnie jutro (jak jest)", plnRange(v.quickLowPln, v.quickHighPln), "szybka sprzedaż kodu bez użytkowników/marki")}
                {row("Trudność", `${v.difficulty}/10`, v.difficultyLabel)}
                <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Uwaga: realna wartość rośnie z <b>użytkownikami i dystrybucją</b>, nie z samym kodem. Z płacącymi
                  klientami / abonamentem wycena bywa wielokrotnie wyższa niż „jak jest".
                </p>
              </>
            );
          })()}

          {tab === "licenses" && (
            <>
              <h3>➕ Wydaj klucz licencyjny</h3>
              <div className="field" style={{ display: "flex", gap: 8 }}>
                <input value={form.name} placeholder="Imię / firma klienta" onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ flex: 2 }} />
                <input type="number" value={form.days} placeholder="Dni (∞)" onChange={(e) => setForm({ ...form, days: e.target.value })} style={{ flex: 1 }} />
                <input type="number" value={form.limit} placeholder="Urz." onChange={(e) => setForm({ ...form, limit: e.target.value })} style={{ width: 70 }} />
              </div>
              <button className="btn primary" onClick={issue}>🔑 Wygeneruj klucz</button>
              {newKey && (
                <div className="journal-card" style={{ marginTop: 8 }}>
                  <div className="muted" style={{ fontSize: 12 }}>Nowy klucz (kliknij, by skopiować):</div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all", cursor: "pointer" }} onClick={() => copyWithToast(newKey, "Klucz skopiowany ✓")}>{newKey}</div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                <h3 style={{ margin: 0 }}>📋 Kto korzysta</h3>
                <button className="btn" style={{ width: "auto", marginTop: 0, padding: "6px 12px" }} onClick={() => refresh()}>↻ Odśwież</button>
              </div>
              {msg && <p className="muted" style={{ fontSize: 13 }}>{msg}</p>}
              {rows === null ? (
                <p className="muted" style={{ fontSize: 13 }}>Wpisz dane serwera w „🗝 Moje klucze", potem odśwież.</p>
              ) : rows.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>Brak wydanych licencji.</p>
              ) : (
                rows.map((l) => (
                  <div key={l.id} className="journal-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <b>{l.name}</b>
                      <span className="chip" style={{ color: l.revoked ? "#ff8585" : "var(--ok, #58e08a)" }}>{l.revoked ? "unieważniona" : "aktywna"}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {l.type}{l.exp ? ` do ${new Date(l.exp).toLocaleDateString("pl-PL")}` : ""} · urządzenia {l.devices}/{l.deviceLimit} ·{" "}
                      {l.lastSeen ? `ost. aktywność ${new Date(l.lastSeen).toLocaleString("pl-PL")}` : "nieaktywowana"}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <button className="chip" onClick={async () => { await revokeLicense(cfg, l.id, !l.revoked); refresh(); }}>
                        {l.revoked ? "↩ Przywróć" : "⛔ Unieważnij"}
                      </button>
                      <button className="chip" onClick={async () => { if (confirm("Wyzerować urządzenia tej licencji?")) { await resetDevices(cfg, l.id); refresh(); } }}>♻ Reset urządzeń</button>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
