import { useEffect, useState } from "react";
import { store } from "../lib/store";
import { loadVoices, speak } from "../lib/voice";
import type { Settings } from "../types";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <div className={`switch ${on ? "on" : ""}`} onClick={onClick} />;
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings>({ ...store.settings });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    loadVoices().then(setVoices);
  }, []);

  const set = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }));

  const save = () => {
    store.setSettings(s);
    onClose();
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>⚙ Ustawienia</h2>

        <h3>Mózg AI</h3>
        <div className="field">
          <label>Klucz API Anthropic (przechowywany tylko na urządzeniu)</label>
          <input
            type="password"
            value={s.anthropicApiKey}
            placeholder="sk-ant-..."
            onChange={(e) => set({ anthropicApiKey: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Model</label>
          <select value={s.model} onChange={(e) => set({ model: e.target.value })}>
            <option value="claude-opus-4-8">Claude Opus 4.8 — maksymalna inteligencja</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 — szybki i bystry</option>
            <option value="claude-haiku-4-5">Claude Haiku 4.5 — najszybszy</option>
          </select>
        </div>
        <div className="field">
          <label>Jak JARVIS ma się do Ciebie zwracać</label>
          <input value={s.userName} onChange={(e) => set({ userName: e.target.value })} />
        </div>
        <div className="row">
          <span>Wyszukiwanie w sieci (aktualne dane)</span>
          <Toggle on={s.webSearch} onClick={() => set({ webSearch: !s.webSearch })} />
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
        <p className="muted">
          Dla brzmienia najbliższego oryginałowi możesz wgrać własny klucz ElevenLabs i ID głosu.
        </p>
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

        <button className="btn primary" onClick={save}>
          Zapisz
        </button>
      </div>
    </div>
  );
}
