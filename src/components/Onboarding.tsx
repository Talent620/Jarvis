import { useMemo, useState } from "react";
import { store } from "../lib/store";
import { detectProvider, PROVIDERS, autoPick } from "../lib/providers/registry";
import { testProvider } from "../lib/brain";
import { speak } from "../lib/voice";
import { cue } from "../lib/feedback";

// Pierwsze uruchomienie: 3 kroki — (1) mózg AI, (2) głos i charakter, (3) tour po
// funkcjach. Pokazywany raz; pomijalny w każdej chwili. Stan w localStorage.
const FLAG = "jarvis.onboarded.v1";
export const needsOnboarding = (): boolean => {
  try {
    return !localStorage.getItem(FLAG);
  } catch {
    return false;
  }
};
const markDone = () => {
  try {
    localStorage.setItem(FLAG, String(Date.now()));
  } catch {
    /* ignore */
  }
};

const PERSONAS = [
  { id: "classic", icon: "🎩", name: "Klasyczny", desc: "brytyjski majordomus — elegancki i rzeczowy" },
  { id: "operator", icon: "🎯", name: "Operator", desc: "minimum słów, maksimum konkretu" },
  { id: "warm", icon: "🤗", name: "Ciepły", desc: "wspierający i empatyczny" },
  { id: "witty", icon: "😏", name: "Błyskotliwy", desc: "suchy humor, lekki sarkazm" },
];

const TOUR = [
  { icon: "🎙", text: "Mów albo pisz — JARVIS działa: zadania, SMS-y, nawigacja, smart home." },
  { icon: "☎", text: "Rozmowa na żywo — naciśnij słuchawkę i rozmawiaj jak przez telefon." },
  { icon: "🎨", text: "Studio Obrazów — generuj i edytuj zdjęcia opisem (⋯ → Studio)." },
  { icon: "💰", text: "Zarabianie — JARVIS szuka klientów, pisze oferty i buduje strony (⋯ → 💰)." },
  { icon: "📔", text: "Dziennik, sejf haseł, szyfr, pulsometr — wszystko w ⋯ i 🧰." },
  { icon: "🔐", text: "Wszystko zostaje na Twoim urządzeniu. Kopia zapasowa w ⚙ → Dane." },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [key, setKey] = useState("");
  const [keyMsg, setKeyMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [name, setName] = useState(store.settings.userName === "Sir" ? "" : store.settings.userName);
  const [persona, setPersona] = useState(store.settings.persona || "classic");

  // Buildy z GitHuba mają wstrzyknięte klucze — wtedy krok 1 to tylko potwierdzenie.
  const builtIn = useMemo(() => autoPick(store.settings.keys), []);

  const next = () => {
    cue("confirm");
    setLeaving(true);
    setTimeout(() => {
      setLeaving(false);
      setStep((s) => s + 1);
    }, 180);
  };

  const finish = () => {
    if (name.trim()) store.setSettings({ userName: name.trim() });
    store.setSettings({ persona });
    markDone();
    cue("wake");
    onDone();
  };

  const addKey = async () => {
    const k = key.trim();
    const prov = detectProvider(k);
    if (!prov) {
      setKeyMsg("Nie rozpoznaję tego klucza — sprawdź, czy skopiowałeś całość.");
      return;
    }
    setTesting(true);
    setKeyMsg(`Łączę z ${PROVIDERS[prov].label}…`);
    store.setSettings({ keys: { ...store.settings.keys, [prov]: k } });
    const result = await testProvider(prov, k);
    setTesting(false);
    setKeyMsg(result);
    if (result.startsWith("✅")) {
      setTimeout(next, 700);
    }
  };

  const tryVoice = () => {
    const n = name.trim() || store.settings.userName;
    speak(`Witaj, ${n}. Systemy online. Jestem do usług.`, { ...store.settings, persona, speak: true });
  };

  return (
    <div className="onboard">
      <div className={`onboard-card ${leaving ? "leave" : "enter"}`}>
        {step === 0 && (
          <>
            <div className="onboard-orb" />
            <h1>JARVIS</h1>
            <p className="onboard-sub">Twój osobisty system AI — głos, działanie, pamięć.</p>
            {builtIn ? (
              <>
                <p className="onboard-ok">✅ Mózg AI gotowy: {PROVIDERS[builtIn.provider].label}</p>
                <button className="btn primary onboard-cta" onClick={next}>Rozpocznij konfigurację →</button>
              </>
            ) : (
              <>
                <p className="muted">
                  Podłącz mózg: wklej dowolny klucz API.{" "}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style={{ color: "var(--cyan)" }}>
                    Darmowy klucz Gemini
                  </a>{" "}
                  (1 minuta, bez karty).
                </p>
                <div style={{ display: "flex", gap: 8, width: "100%" }}>
                  <input
                    value={key}
                    placeholder="Wklej klucz API…"
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addKey()}
                    style={{ flex: 1 }}
                  />
                  <button className="btn primary" style={{ width: "auto", marginTop: 0 }} onClick={addKey} disabled={!key.trim() || testing}>
                    {testing ? "⏳" : "Połącz"}
                  </button>
                </div>
                {keyMsg && <p className="muted" style={{ marginTop: 8 }}>{keyMsg}</p>}
                <button className="onboard-skip" onClick={next}>Pomiń — skonfiguruję później</button>
              </>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h1>Głos i charakter</h1>
            <p className="onboard-sub">Jak JARVIS ma się do Ciebie zwracać i jakim być?</p>
            <input
              value={name}
              placeholder="Twoje imię (np. Marcin)"
              onChange={(e) => setName(e.target.value)}
              style={{ width: "100%" }}
            />
            <div className="onboard-personas">
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  className={`onboard-persona ${persona === p.id ? "on" : ""}`}
                  onClick={() => setPersona(p.id)}
                >
                  <span style={{ fontSize: 22 }}>{p.icon}</span>
                  <b>{p.name}</b>
                  <span className="muted" style={{ fontSize: 11 }}>{p.desc}</span>
                </button>
              ))}
            </div>
            <button className="btn" onClick={tryVoice}>🔊 Posłuchaj próbki</button>
            <button className="btn primary onboard-cta" onClick={next}>Dalej →</button>
          </>
        )}

        {step === 2 && (
          <>
            <h1>Co potrafi JARVIS</h1>
            <div className="onboard-tour">
              {TOUR.map((t, i) => (
                <div key={i} className="onboard-tip" style={{ animationDelay: `${i * 90}ms` }}>
                  <span style={{ fontSize: 20, width: 30 }}>{t.icon}</span>
                  <span>{t.text}</span>
                </div>
              ))}
            </div>
            <button className="btn primary onboard-cta" onClick={finish}>🚀 Uruchom JARVIS</button>
          </>
        )}

        <div className="onboard-dots">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`onboard-dot ${i === step ? "on" : ""}`} />
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>© 2026 Artur Józefczak · Wszelkie prawa zastrzeżone</div>
      </div>
    </div>
  );
}
