import { useState } from "react";
import { verifyPin, lockoutRemainingMs } from "../lib/lock";

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");

  const submit = async () => {
    const wait = lockoutRemainingMs();
    if (wait > 0) { setMsg(`Za dużo prób — poczekaj ${Math.ceil(wait / 1000)} s.`); return; }
    if (await verifyPin(pin)) { onUnlock(); return; }
    setPin("");
    const after = lockoutRemainingMs();
    setMsg(after > 0 ? `Za dużo prób — poczekaj ${Math.ceil(after / 1000)} s.` : "Błędny PIN.");
  };

  return (
    <div className="sheet live" style={{ zIndex: 200 }} onClick={(e) => e.stopPropagation()}>
      <div className="live-inner">
        <div className="brand" style={{ textAlign: "center" }}>
          JARVIS
          <small>DOSTĘP ZABLOKOWANY</small>
        </div>
        <div style={{ fontSize: 52, margin: "24px 0" }}>🔒</div>
        <p className="muted" style={{ textAlign: "center" }}>Wprowadź PIN, aby odblokować.</p>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          autoFocus
          placeholder="PIN"
          onChange={(e) => {
            setPin(e.target.value);
            setMsg("");
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ maxWidth: 200, textAlign: "center", fontSize: 22, letterSpacing: 6 }}
        />
        {msg && <p className="muted" style={{ color: "var(--danger, #ff6b6b)" }}>{msg}</p>}
        <button className="btn primary" style={{ maxWidth: 200, marginTop: 14 }} onClick={submit} disabled={!pin}>
          Odblokuj
        </button>
      </div>
    </div>
  );
}
