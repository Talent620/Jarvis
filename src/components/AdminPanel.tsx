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
import {
  parsePrivateJwk,
  privateMatchesApp,
  issueLocalLicense,
  extendLocalLicense,
  listLocalLicenses,
  removeLocalLicense,
  licenseStatus,
  decodeLicense,
  type LicenseRecord,
} from "../lib/licenseSign";
import { verifyLicense } from "../lib/license";

// Panel administratora w wersji premium — wewnątrz JARVIS-a. Odblokowanie
// numerem właściciela (dostęp awaryjny), sekrety szyfrowane lokalnie.
export default function AdminPanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [phone, setPhone] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [cfg, setCfg] = useState<AdminConfig>({ workerUrl: "", adminToken: "" });
  const [tab, setTab] = useState<"licenses" | "offline" | "keys" | "value">("licenses");
  const [rows, setRows] = useState<LicenseRow[] | null>(null);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ name: "", days: "", limit: "1" });
  const [newKey, setNewKey] = useState("");
  // Offline-generator (podpis lokalny własnym kluczem prywatnym):
  const [priv, setPriv] = useState("");
  const [offForm, setOffForm] = useState({ owner: "", days: "30" });
  const [localRows, setLocalRows] = useState<LicenseRecord[]>(() => listLocalLicenses());
  // 🔎 Inspektor klucza — wklej dowolny klucz, sprawdź dla kogo / typ / dni / ważność podpisu.
  const [insKey, setInsKey] = useState("");
  const [insRes, setInsRes] = useState("");
  const inspectKey = async () => {
    const key = insKey.trim();
    const p = decodeLicense(key);
    if (!p) { setInsRes("❌ Nie mogę odczytać klucza — wklej PEŁNY ciąg (z kropką w środku)."); return; }
    const st = licenseStatus(p.exp ?? null);
    const v = await verifyLicense(key);
    const verdict = v.valid
      ? "✅ Klucz PRAWIDŁOWY i AKTYWNY"
      : p.exp && Date.now() > p.exp
        ? "⏳ Klucz WYGASŁ"
        : "❌ Podpis NIEPRAWIDŁOWY (podrobiony albo do innej wersji aplikacji)";
    setInsRes(`${verdict}\nDla: ${p.n || "(brak)"} · typ: ${p.t || "(brak)"} · ${st.label}`);
  };

  const unlock = async () => {
    if (!(await verifyOwnerPhone(phone))) {
      setMsg("❌ Nieprawidłowy numer właściciela.");
      return;
    }
    const c = await loadAdminConfig(phone);
    setCfg(c || { workerUrl: "", adminToken: "" });
    setPriv(c?.signerPriv || "");
    setUnlocked(true);
    setMsg("");
    if (c?.adminToken) void refresh(c);
  };

  // --- Offline-generator: podpis lokalny własnym kluczem prywatnym ---
  const genOffline = async () => {
    const jwk = parsePrivateJwk(priv);
    if (!jwk) { toast("Najpierw wklej poprawny klucz prywatny (EC P-256)."); return; }
    if (!offForm.owner.trim()) { toast('Podaj właściciela klucza (np. „tester młody”).'); return; }
    const rec = await issueLocalLicense(jwk, offForm.owner.trim(), offForm.days ? Number(offForm.days) : 0);
    setLocalRows(listLocalLicenses());
    setOffForm({ owner: "", days: "30" });
    copyWithToast(rec.token, "Podpisano i skopiowano ✓");
  };
  const extendOff = async (r: LicenseRecord, days: number) => {
    const jwk = parsePrivateJwk(priv);
    if (!jwk) { toast("Wklej klucz prywatny, by przedłużać."); return; }
    const up = await extendLocalLicense(jwk, r, days);
    setLocalRows(listLocalLicenses());
    copyWithToast(up.token, `Przedłużono (${days ? days + " dni" : "bezterminowo"}) i skopiowano ✓`);
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
            <button className={`chip ${tab === "offline" ? "on" : ""}`} onClick={() => setTab("offline")}>🔏 Offline</button>
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

          {tab === "offline" && (() => {
            const jwk = priv.trim() ? parsePrivateJwk(priv) : null;
            return (
              <>
                {/* 🔎 Inspektor klucza — bez komputera: wklej klucz, sprawdź dni i ważność */}
                <div className="journal-card" style={{ padding: "10px 12px", marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>🔎 Sprawdź klucz (dla kogo · dni · ważność)</div>
                  <textarea className="ta" value={insKey} placeholder="Wklej klucz licencyjny…" onChange={(e) => setInsKey(e.target.value)} style={{ minHeight: 56, fontFamily: "monospace", fontSize: 11 }} />
                  <button className="btn" style={{ marginTop: 6 }} disabled={!insKey.trim()} onClick={() => void inspectKey()}>🔎 Sprawdź</button>
                  {insRes && <pre className="notice" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{insRes}</pre>}
                </div>
                <Guide title="ℹ Jak to działa (offline — Twój własny klucz)" open>
                  <p>Wklej swój <b>klucz prywatny</b> (zawartość pliku <i>license-private.json</i>). Zostaje <b>tylko u Ciebie</b>, zaszyfrowany Twoim numerem — nigdzie go nie wysyłamy. Podpisuje klucze <b>lokalnie</b>, bez serwera.</p>
                  <p>Klucz musi pasować do <b>klucza publicznego tej wersji aplikacji</b> — inaczej wydane licencje się nie aktywują (każdy „szef" z własnym kluczem potrzebuje wersji z jego kluczem publicznym).</p>
                  <p>⚠ Offline nie śledzi użycia (ile urządzeń) — to widać tylko dla kluczy z serwera (zakładka „📋 Licencje"). Tu pokazujemy właściciela, termin i status.</p>
                </Guide>

                <div className="field">
                  <label>Twój klucz prywatny (zawartość license-private.json)</label>
                  <textarea className="ta" value={priv} placeholder='{"kty":"EC","crv":"P-256","d":"…","x":"…","y":"…"}' onChange={(e) => setPriv(e.target.value)} style={{ minHeight: 70, fontFamily: "monospace", fontSize: 11 }} />
                </div>
                {priv.trim() && (
                  !jwk ? (
                    <p className="muted" style={{ color: "#ff8585", fontSize: 13 }}>⚠ To nie jest poprawny klucz prywatny EC P-256.</p>
                  ) : privateMatchesApp(jwk) ? (
                    <p className="muted" style={{ color: "var(--ok, #58e08a)", fontSize: 13 }}>✅ Pasuje do tej aplikacji — wydane klucze będą się aktywować.</p>
                  ) : (
                    <p className="muted" style={{ color: "var(--gold)", fontSize: 13 }}>⚠ Ten klucz NIE pasuje do klucza publicznego tej wersji — wydane nim licencje się tu nie aktywują.</p>
                  )
                )}
                <button className="btn" onClick={async () => { await persist({ ...cfg, signerPriv: priv }); toast("Klucz prywatny zapisany (zaszyfrowany) ✓"); }}>💾 Zapamiętaj klucz prywatny</button>

                <h3 style={{ marginTop: 16 }}>➕ Podpisz klucz dla kogoś</h3>
                <div className="field" style={{ display: "flex", gap: 8 }}>
                  <input value={offForm.owner} placeholder='Właściciel (np. „tester młody", „szef — ja")' onChange={(e) => setOffForm({ ...offForm, owner: e.target.value })} style={{ flex: 2 }} />
                  <input type="number" min="0" value={offForm.days} placeholder="Dni (∞)" onChange={(e) => setOffForm({ ...offForm, days: e.target.value })} style={{ flex: 1 }} />
                </div>
                <button className="btn primary" onClick={genOffline}>🔏 Podpisz i skopiuj</button>

                <h3 style={{ marginTop: 16 }}>📋 Wydane klucze (kto · na ile · status)</h3>
                {localRows.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>Brak. Podpisz pierwszy klucz powyżej — każdy ma właściciela.</p>
                ) : (
                  localRows.map((r) => {
                    const st = licenseStatus(r.exp);
                    const tone = st.tone === "err" ? "#ff8585" : st.tone === "warn" ? "var(--gold)" : "var(--ok, #58e08a)";
                    return (
                      <div key={r.id} className="journal-card">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                          <b>{r.owner}</b>
                          <span className="chip" style={{ color: tone }}>{st.label}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {r.type === "perpetual" ? "bezterminowy" : `do ${r.exp ? new Date(r.exp).toLocaleDateString("pl-PL") : "—"}`} · wydany {new Date(r.iat).toLocaleDateString("pl-PL")}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                          <button className="chip" onClick={() => copyWithToast(r.token, "Klucz skopiowany ✓")}>📋 Kopiuj</button>
                          <button className="chip" onClick={() => extendOff(r, 30)}>⏳ +30 dni</button>
                          <button className="chip" onClick={() => extendOff(r, 365)}>+365</button>
                          <button className="chip" onClick={() => extendOff(r, 0)}>∞ bezterminowo</button>
                          <button className="chip" onClick={() => { if (confirm(`Usunąć z rejestru klucz „${r.owner}"? (sam token u właściciela nadal działa do wygaśnięcia)`)) { removeLocalLicense(r.id); setLocalRows(listLocalLicenses()); } }}>🗑</button>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            );
          })()}

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
                {row("Ile zajęłoby innym", `${v.hoursSenior.toLocaleString("pl-PL")}–${v.hoursMid.toLocaleString("pl-PL")} h`, `senior (zna stack) → mid (z nauką) · zespół 3 os.: ~${v.teamMonths} mies.`)}
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
                <input type="number" min="0" value={form.days} placeholder="Dni (∞)" onChange={(e) => setForm({ ...form, days: e.target.value })} style={{ flex: 1 }} />
                <input type="number" min="1" value={form.limit} placeholder="Urz." onChange={(e) => setForm({ ...form, limit: e.target.value })} style={{ width: 70 }} />
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
