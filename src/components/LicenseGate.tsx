import { useState } from "react";
import { verifyLicense, saveLicense } from "../lib/license";

// Brama aktywacji: bez ważnego klucza licencyjnego aplikacja się nie uruchamia.
// Klucz wydaje wyłącznie autor (Artur Józefczak). Kopia bez klucza jest bezużyteczna.
export default function LicenseGate({ onActivated }: { onActivated: (name?: string) => void }) {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const activate = async () => {
    const t = key.trim();
    if (!t) return;
    setBusy(true);
    setMsg("Sprawdzam klucz…");
    const r = await verifyLicense(t);
    setBusy(false);
    if (r.valid) {
      saveLicense(t);
      setMsg("✅ Aktywowano. Uruchamiam JARVIS-a…");
      setTimeout(() => onActivated(r.name), 500);
    } else {
      setMsg("❌ Nieprawidłowy lub wygasły klucz licencyjny. Skontaktuj się z autorem, aby uzyskać dostęp.");
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
          <button className="btn primary" style={{ width: "auto", marginTop: 0 }} onClick={activate} disabled={!key.trim() || busy}>
            {busy ? "⏳" : "Aktywuj"}
          </button>
        </div>
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
