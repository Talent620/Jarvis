import { useState } from "react";
import { activateLicense, saveLicense } from "../lib/license";

// Brama aktywacji: bez ważnego klucza licencyjnego aplikacja się nie uruchamia.
// Klucz wydaje wyłącznie autor (Artur Józefczak). Kopia bez klucza jest bezużyteczna.
export default function LicenseGate({ onActivated }: { onActivated: (name?: string) => void }) {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const activate = async (raw?: string) => {
    // Usuń WSZYSTKIE białe znaki — kopiowanie z telefonu/maila często wstawia
    // spacje lub zawijania wiersza, które psuły poprawny klucz.
    const t = (raw ?? key).replace(/\s+/g, "");
    if (!t) return;
    setBusy(true);
    setMsg("Sprawdzam i aktywuję klucz…");
    const r = await activateLicense(t);
    setBusy(false);
    if (r.valid) {
      saveLicense(t);
      setMsg("✅ Aktywowano. Uruchamiam JARVIS-a…");
      setTimeout(() => onActivated(r.name), 500);
    } else {
      setMsg("❌ Klucz nieprawidłowy lub niepełny. Skopiuj go w całości (163 znaki) i wklej przyciskiem 📋 — bez spacji.");
    }
  };

  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).replace(/\s+/g, "");
      if (!t) { setMsg("Schowek jest pusty — skopiuj klucz i spróbuj ponownie."); return; }
      setKey(t);
      await activate(t);
    } catch {
      setMsg("Brak dostępu do schowka — wklej klucz ręcznie (Ctrl+V) w pole.");
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-card enter">
        <div className="onboard-orb" />
        <h1>JARVIS</h1>
        <p className="onboard-sub">Ten program jest licencjonowany. Wprowadź klucz dostępu, aby aktywować.</p>

        <div style={{ display: "flex", gap: 8, width: "100%" }}>
          <input
            value={key}
            placeholder="Klucz licencyjny…"
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && activate()}
            spellCheck={false}
            style={{ flex: 1, fontFamily: "monospace", fontSize: 13 }}
          />
          <button className="btn primary" style={{ width: "auto", marginTop: 0 }} onClick={() => activate()} disabled={!key.trim() || busy}>
            {busy ? "⏳" : "Aktywuj"}
          </button>
        </div>
        <button className="btn" style={{ marginTop: 8 }} onClick={paste} disabled={busy}>
          📋 Wklej klucz ze schowka i aktywuj
        </button>
        {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}

        <p className="muted" style={{ marginTop: 18, fontSize: 13, lineHeight: 1.6 }}>
          Nie masz klucza? Dostęp lub licencję (osobistą / komercyjną) można uzyskać
          <b> za zgodą autora</b>. Skontaktuj się, aby wykupić dostęp.
        </p>
        <div className="muted" style={{ fontSize: 11, marginTop: 14 }}>© 2026 Artur Józefczak · Wszelkie prawa zastrzeżone</div>
      </div>
    </div>
  );
}
