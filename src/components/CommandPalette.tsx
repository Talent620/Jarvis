import { useState, useRef, useEffect, useMemo } from "react";
import { rankCommands, type CommandItem } from "../lib/commandPalette";
import { useEscape } from "../hooks/useEscape";

// ⌘K / Ctrl+K — spotlight do WSZYSTKIEGO: panele, narzędzia, akcje. Klawiatura: ↑↓ Enter Esc.
export default function CommandPalette({ commands, onClose }: { commands: CommandItem[]; onClose: () => void }) {
  useEscape(onClose);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => rankCommands(q, commands, 9), [q, commands]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [q]);
  // Utrzymaj zaznaczony element w widoku.
  useEffect(() => { listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const exec = (c?: CommandItem) => { if (!c) return; onClose(); setTimeout(() => c.run(), 0); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(Math.max(0, results.length - 1), s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); exec(results[sel]); }
  };

  return (
    <div className="sheet cmdk-sheet" onClick={onClose} role="dialog" aria-modal="true" aria-label="Szybkie polecenia">
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={q}
          placeholder="Wpisz, czego szukasz… (panel · ustawienie · narzędzie)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          aria-label="Szukaj polecenia"
        />
        <div className="cmdk-list" ref={listRef}>
          {results.length === 0 && <div className="cmdk-empty muted">Brak wyników{q ? ` dla „${q}”` : ""}.</div>}
          {results.map((c, i) => (
            <button
              key={c.id}
              className={`cmdk-item ${i === sel ? "on" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => exec(c)}
            >
              <span className="cmdk-icon">{c.icon || "→"}</span>
              <span className="cmdk-title">{c.title}{c.hint ? <span className="cmdk-hint"> · {c.hint}</span> : null}</span>
              {c.group ? <span className="cmdk-group">{c.group}</span> : null}
            </button>
          ))}
        </div>
        <div className="cmdk-foot muted">↑↓ wybór · ⏎ otwórz · esc zamknij</div>
      </div>
    </div>
  );
}
