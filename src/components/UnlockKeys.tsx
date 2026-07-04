import { useState } from "react";
import { unlock } from "../lib/secretsVault";
import { brand } from "../lib/brand";

// Ekran odblokowania kluczy API (gdy włączone szyfrowanie w spoczynku). Pokazywany
// przy starcie, dopóki użytkownik nie poda hasła. Można pominąć — wtedy JARVIS działa
// bez kluczy (poprosi o nie przy próbie rozmowy).
export default function UnlockKeys({ onDone }: { onDone: () => void }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const tryUnlock = async () => {
    if (!pass.trim()) return;
    setBusy(true);
    setMsg("Odszyfrowuję klucze…");
    const ok = await unlock(pass);
    setBusy(false);
    if (ok) {
      onDone();
    } else {
      setMsg("❌ Złe hasło. Spróbuj ponownie lub pomiń i wpisz klucze na nowo (⚙ → AI).");
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-card enter">
        <div className="onboard-orb" />
        <h1>{brand()}</h1>
        <p className="onboard-sub">🔒 Klucze API są zaszyfrowane. Podaj hasło, by odblokować.</p>
        <div style={{ display: "flex", gap: 8, width: "100%" }}>
          <input
            type="password"
            value={pass}
            placeholder="Hasło do kluczy…"
            autoFocus
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void tryUnlock()}
            style={{ flex: 1 }}
          />
          <button className="btn primary" style={{ width: "auto", marginTop: 0 }} onClick={() => void tryUnlock()} disabled={!pass.trim() || busy}>
            {busy ? "⏳" : "Odblokuj"}
          </button>
        </div>
        {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
        <button className="onboard-skip" onClick={onDone}>Pomiń — wpiszę klucze później</button>
      </div>
    </div>
  );
}
