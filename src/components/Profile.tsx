import { useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { store } from "../lib/store";
import { emptyProfile, type UserProfile } from "../lib/profile";
import { toast } from "../lib/toast";

const FIELDS: { key: keyof UserProfile; label: string; placeholder: string; rows?: number }[] = [
  { key: "about", label: "O mnie", placeholder: "Kim jesteś, kilka słów o sobie…", rows: 3 },
  { key: "occupation", label: "Czym się zajmuję / praca", placeholder: "Zawód, branża, rola…" },
  { key: "interests", label: "Zainteresowania", placeholder: "Pasje, hobby, tematy które lubisz…", rows: 2 },
  { key: "goals", label: "Cele", placeholder: "Co chcesz osiągnąć — krótko i długoterminowo…", rows: 2 },
  { key: "preferences", label: "Preferencje / jak ze mną rozmawiać", placeholder: "Np. zwięźle, po polsku, bez ozdobników, konkrety…", rows: 2 },
];

// Mój profil — stała pamięć JARVIS-a o Tobie. To, co tu wpiszesz, jest w KAŻDEJ
// rozmowie (obok pamięci semantycznej i kontekstu sesji). Lokalnie, prywatnie.
export default function Profile({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [p, setP] = useState<UserProfile>({ ...emptyProfile, ...store.settings.profile });
  const [name, setName] = useState(store.settings.userName === "Sir" ? "" : store.settings.userName);

  const save = () => {
    store.setSettings({ profile: p, ...(name.trim() ? { userName: name.trim() } : {}) });
    toast("Profil zapisany — JARVIS już Cię pamięta ✓");
    onClose();
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>👤 Mój profil</h2>
        </div>
        <div className="panel-body">
          <p className="muted">
            To stała pamięć JARVIS-a o Tobie — uwzględnia ją w <b>każdej</b> rozmowie, żeby odpowiadał
            pod Ciebie. Wszystko lokalnie i prywatnie; wchodzi też do kopii zapasowej.
          </p>

          <div className="field">
            <label>Imię (jak ma się do Ciebie zwracać)</label>
            <input value={name} placeholder="np. Marcin" onChange={(e) => setName(e.target.value)} />
          </div>

          {FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <textarea
                className="ta"
                style={{ minHeight: (f.rows || 2) * 26 }}
                value={p[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setP((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}

          <button className="btn primary" onClick={save}>💾 Zapisz profil</button>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Wskazówka: możesz też po prostu powiedzieć JARVIS-owi „zapamiętaj, że…" — trafne fakty
            zapisze sam. Profil jest do rzeczy, które chcesz mieć <b>na stałe</b>.
          </p>
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
