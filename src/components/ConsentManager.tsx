import { useState } from "react";
import { listRememberedConsents, resetConsents, revokeConsent, requiresFreshConsent } from "../lib/permissions";

/** Cofnięcie zapisanych zgód dla konkretnych narzędzi. Nie zarządza uprawnieniami systemu. */
export default function ConsentManager() {
  const [tools, setTools] = useState(listRememberedConsents);
  const [message, setMessage] = useState("");
  const refresh = (ok: boolean) => {
    setTools(listRememberedConsents());
    setMessage(ok ? "Zgody zapisane." : "Nie udało się zapisać zmian w pamięci przeglądarki.");
  };
  return <div>
    <p className="muted">Zgody dotyczą typów działań JARVIS-a. Uprawnieniami do ekranu, mikrofonu i sterowania zarządza system. Wysłanie wiadomości wymaga osobnego potwierdzenia.</p>
    {tools.length ? <ul>
      {tools.map((tool) => <li key={tool} className="row"><span>{tool}{requiresFreshConsent(tool) ? " — wymagane jednorazowe potwierdzenie" : ""}</span><button type="button" className="chip" aria-label={`Cofnij zgodę ${tool}`} onClick={() => refresh(revokeConsent(tool))}>Cofnij</button></li>)}
    </ul> : <p className="muted">Brak zapamiętanych zgód.</p>}
    <button type="button" className="btn" onClick={() => refresh(resetConsents())}>Zresetuj zapamiętane zgody</button>
    {message && <p role="status" className="muted">{message}</p>}
  </div>;
}
