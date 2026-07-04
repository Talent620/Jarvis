import { useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { loadBrandKit, saveBrandKit, hasBrandKit } from "../lib/brandKit";
import type { BrandKit as BrandKitType } from "../types";

// 🎨 Dusza Marki — jedno miejsce na tożsamość (ton, kolory, fonty, słowa). Zapisana raz, wstrzykiwana
// automatycznie do generatora stron, treści i obrazów — dla spójności wizualnej i językowej.
const FIELDS: { key: keyof BrandKitType; label: string; placeholder: string; area?: boolean }[] = [
  { key: "name", label: "Nazwa marki", placeholder: "np. Lipa Cafe" },
  { key: "tagline", label: "Hasło przewodnie", placeholder: "np. Kawa jak w domu" },
  { key: "voice", label: "Ton głosu", placeholder: "np. ciepły, ekspercki, bez żargonu" },
  { key: "audience", label: "Grupa docelowa", placeholder: "np. mieszkańcy okolicy, 25–45 lat" },
  { key: "colors", label: "Kolory marki", placeholder: "np. brąz #5A3E2B, krem #F3E9DC" },
  { key: "fonts", label: "Typografia", placeholder: "np. nagłówki Playfair, tekst Inter" },
  { key: "keywords", label: "Słowa kluczowe / styl", placeholder: "np. rzemieślnicza, przytulna, naturalna" },
  { key: "avoid", label: "Czego unikać", placeholder: "np. tani, agresywny, korporacyjny", area: true },
];

export default function BrandKit({ onClose, embedded }: { onClose: () => void; embedded?: boolean }) {
  useEscape(onClose);
  const [kit, setKit] = useState<BrandKitType>(() => ({ ...loadBrandKit() }));

  const set = (k: keyof BrandKitType, v: string) => {
    const next = { ...kit, [k]: v };
    setKit(next);
    saveBrandKit(next); // zapis na bieżąco — bez przycisku „Zapisz"
  };

  const body = (
        <div className="panel-body">
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            Ustaw raz tożsamość marki — JARVIS użyje jej automatycznie przy tworzeniu <b>stron</b>, <b>treści</b> i <b>obrazów</b>,
            dla spójnego wyglądu i języka. Zmiany zapisują się od razu. Puste pola = brak wpływu.
          </p>
          <div className={`brand-status ${hasBrandKit(kit) ? "on" : ""}`} style={{ fontSize: 12, margin: "4px 0 10px", color: hasBrandKit(kit) ? "#39d98a" : "var(--text-dim)" }}>
            {hasBrandKit(kit) ? "✅ Marka aktywna — wstrzykuję ją do generacji." : "⚪ Marka pusta — generacja działa jak dotąd."}
          </div>
          {FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              {f.area ? (
                <textarea className="ta" style={{ minHeight: 48 }} value={kit[f.key] || ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input value={kit[f.key] || ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
  );
  if (embedded) return body;
  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🎨 Dusza Marki</h2>
        </div>
        {body}
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Gotowe</button>
        </div>
      </div>
    </div>
  );
}
