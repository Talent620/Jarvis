import { useEffect, useMemo, useState } from "react";
import { store } from "../lib/store";
import { loadVoices, speak } from "../lib/voice";
import { PROVIDER_LIST, PROVIDERS, autoPick } from "../lib/providers/registry";
import type { ProviderId } from "../lib/providers/types";
import type { Settings } from "../types";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <div className={`switch ${on ? "on" : ""}`} onClick={onClick} />;
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings>(() => ({ ...store.settings, keys: { ...store.settings.keys } }));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    loadVoices().then(setVoices);
  }, []);

  const set = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }));
  const setKey = (id: ProviderId, val: string) => setS((prev) => ({ ...prev, keys: { ...prev.keys, [id]: val } }));

  // Lista modeli dla wybranego dostawcy (lub info o auto).
  const modelOptions = useMemo(() => {
    if (s.provider === "auto") return [];
    return PROVIDERS[s.provider as ProviderId]?.models ?? [];
  }, [s.provider]);

  const autoTarget = useMemo(() => (s.provider === "auto" ? autoPick(s.keys) : null), [s.provider, s.keys]);

  const save = () => {
    // Jeśli zmieniono dostawcę, a model nie pasuje — zresetuj na domyślny.
    let next = { ...s };
    if (next.provider !== "auto") {
      const meta = PROVIDERS[next.provider as ProviderId];
      if (meta && next.model !== "auto" && !meta.models.some((m) => m.id === next.model)) {
        next.model = meta.defaultModel;
      }
    }
    store.setSettings(next);
    onClose();
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>⚙ Ustawienia</h2>
        </div>
        <div className="panel-body">
          <h3>Dostawca AI</h3>
        <div className="field">
          <label>Dostawca</label>
          <select value={s.provider} onChange={(e) => set({ provider: e.target.value, model: "auto" })}>
            <option value="auto">⚡ Auto — wybierz najlepszy dostępny</option>
            {PROVIDER_LIST.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {s.provider === "auto" ? (
          <p className="muted">
            {autoTarget
              ? `Tryb auto użyje: ${PROVIDERS[autoTarget.provider].label} · ${autoTarget.model}. Wpisz klucze poniżej — im wyżej na liście, tym wyższy priorytet.`
              : "Brak kluczy. Wprowadź przynajmniej jeden klucz API poniżej."}
          </p>
        ) : (
          <div className="field">
            <label>Model</label>
            <select value={s.model} onChange={(e) => set({ model: e.target.value })}>
              <option value="auto">Domyślny modelu dostawcy</option>
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <h3>Klucze API (lokalnie na urządzeniu)</h3>
        {PROVIDER_LIST.map((p) => (
          <div className="field" key={p.id}>
            <label>
              {p.label}
              {p.needsProxy ? " · może wymagać proxy (CORS)" : ""} —{" "}
              <a href={p.keysUrl} target="_blank" rel="noopener" style={{ color: "var(--cyan)" }}>
                klucz
              </a>
            </label>
            <input
              type="password"
              value={s.keys[p.id] || ""}
              placeholder={p.id === "anthropic" ? "sk-ant-..." : "klucz API"}
              onChange={(e) => setKey(p.id, e.target.value)}
            />
          </div>
        ))}

        <div className="field">
          <label>Backend-proxy (opcjonalnie — omija CORS, chowa klucze)</label>
          <input
            value={s.proxyUrl}
            placeholder="https://twoj-proxy.vercel.app/api"
            onChange={(e) => set({ proxyUrl: e.target.value })}
          />
        </div>

        <div className="field">
          <label>Jak JARVIS ma się do Ciebie zwracać</label>
          <input value={s.userName} onChange={(e) => set({ userName: e.target.value })} />
        </div>
        <div className="row">
          <span>Wyszukiwanie w sieci (gdy dostawca wspiera)</span>
          <Toggle on={s.webSearch} onClick={() => set({ webSearch: !s.webSearch })} />
        </div>

        <h3>Osobowość</h3>
        <div className="field">
          <label>Charakter JARVIS-a</label>
          <select value={s.persona} onChange={(e) => set({ persona: e.target.value })}>
            <option value="classic">Klasyczny — elegancki majordomus</option>
            <option value="concise">Zwięzły — krótko i na temat</option>
            <option value="warm">Ciepły — wspierający i empatyczny</option>
            <option value="witty">Błyskotliwy — suchy brytyjski humor</option>
          </select>
        </div>
        <div className="field">
          <label>Własne wytyczne osobowości (opcjonalnie)</label>
          <input
            value={s.customPersona}
            placeholder="np. mów do mnie per szefie, używaj metafor z motoryzacji"
            onChange={(e) => set({ customPersona: e.target.value })}
          />
        </div>

        <h3>Tryb tłumacza na żywo</h3>
        <p className="muted">
          JARVIS staje się tłumaczem symultanicznym — świetne z „Rozmową na żywo" (☎).
        </p>
        <div className="row">
          <span>Włącz tryb tłumacza</span>
          <Toggle on={s.interpreterMode} onClick={() => set({ interpreterMode: !s.interpreterMode })} />
        </div>
        <div className="field" style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label>Język A</label>
            <input value={s.interpreterFrom} onChange={(e) => set({ interpreterFrom: e.target.value })} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Język B</label>
            <input value={s.interpreterTo} onChange={(e) => set({ interpreterTo: e.target.value })} />
          </div>
        </div>

        <h3>Głos</h3>
        <div className="row">
          <span>Czytaj odpowiedzi na głos</span>
          <Toggle on={s.speak} onClick={() => set({ speak: !s.speak })} />
        </div>
        <div className="row">
          <span>Ciągłe nasłuchiwanie słowa „Jarvis"</span>
          <Toggle on={s.wakeWord} onClick={() => set({ wakeWord: !s.wakeWord })} />
        </div>
        <div className="field">
          <label>Głos systemowy</label>
          <select value={s.voiceName} onChange={(e) => set({ voiceName: e.target.value })}>
            <option value="">Auto (najbardziej „JARVIS-owy")</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </div>
        <div className="chips" style={{ marginBottom: 8 }}>
          {[
            { l: "JARVIS", p: 0.9, r: 1.0 },
            { l: "Głęboki", p: 0.7, r: 0.95 },
            { l: "Neutralny", p: 1.0, r: 1.0 },
            { l: "Energiczny", p: 1.1, r: 1.15 },
          ].map((v) => (
            <button key={v.l} className="chip" onClick={() => set({ voicePitch: v.p, voiceRate: v.r })}>
              {v.l}
            </button>
          ))}
        </div>
        <div className="field">
          <label>Wysokość głosu: {s.voicePitch.toFixed(1)}</label>
          <input
            type="range"
            min="0.1"
            max="2"
            step="0.1"
            value={s.voicePitch}
            onChange={(e) => set({ voicePitch: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Tempo mowy: {s.voiceRate.toFixed(1)}</label>
          <input
            type="range"
            min="0.5"
            max="1.8"
            step="0.1"
            value={s.voiceRate}
            onChange={(e) => set({ voiceRate: Number(e.target.value) })}
          />
        </div>
        <button className="btn" onClick={() => speak("Dzień dobry. Systemy w pełni sprawne.", s)}>
          ▶ Przetestuj głos
        </button>

        <h3>Premium głos JARVIS (ElevenLabs — opcjonalnie)</h3>
        <div className="field">
          <label>Klucz API ElevenLabs</label>
          <input
            type="password"
            value={s.elevenLabsApiKey}
            placeholder="(opcjonalnie)"
            onChange={(e) => set({ elevenLabsApiKey: e.target.value })}
          />
        </div>
        <div className="field">
          <label>ID głosu ElevenLabs</label>
          <input
            value={s.elevenLabsVoiceId}
            placeholder="np. JBFqnCBsd6RMkjVDRZzb"
            onChange={(e) => set({ elevenLabsVoiceId: e.target.value })}
          />
        </div>

        <h3>Fish Audio (tani klon głosu — opcjonalnie)</h3>
        <p className="muted">
          Jakość zbliżona do ElevenLabs, taniej. Sklonuj głos JARVIS z 10–15 s próbki i wklej
          jego reference_id. Ma priorytet nad ElevenLabs, gdy uzupełniony.
        </p>
        <div className="field">
          <label>Klucz API Fish Audio</label>
          <input
            type="password"
            value={s.fishAudioApiKey}
            placeholder="(opcjonalnie)"
            onChange={(e) => set({ fishAudioApiKey: e.target.value })}
          />
        </div>
        <div className="field">
          <label>reference_id głosu Fish Audio</label>
          <input
            value={s.fishAudioVoiceId}
            placeholder="np. 7f92f8afb8ec43bf81429cc1c9199cb1"
            onChange={(e) => set({ fishAudioVoiceId: e.target.value })}
          />
        </div>

        <h3>Smart home (Home Assistant — opcjonalnie)</h3>
        <div className="field">
          <label>Adres Home Assistant</label>
          <input
            value={s.homeAssistantUrl}
            placeholder="http://homeassistant.local:8123"
            onChange={(e) => set({ homeAssistantUrl: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Token dostępu (long-lived)</label>
          <input
            type="password"
            value={s.homeAssistantToken}
            placeholder="(opcjonalnie)"
            onChange={(e) => set({ homeAssistantToken: e.target.value })}
          />
        </div>

        </div>
        <div className="panel-foot">
          <button className="btn primary" onClick={save}>
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}
