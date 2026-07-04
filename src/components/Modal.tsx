import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useEscape } from "../hooks/useEscape";
import { useDirtyClose } from "../hooks/useDirtyClose";
import { FOCUSABLE_SELECTOR, nextTrapIndex } from "../lib/a11y";
import DockSwitcher from "./DockSwitcher";

// Wspólny „arkusz" (modal/panel) — jedno miejsce dla powtarzanej w ~37 ekranach struktury
// .sheet/.panel/.panel-head/.panel-body/.panel-foot. Zachowanie 1:1 z dotychczasowym (klik w tło
// zamyka, klik w panel nie propaguje, Escape zamyka), a DODATKOWO centralnie dokłada dostępność
// (role="dialog", aria-modal, aria-label z tytułu) — wcześniej brakowało jej w każdym modalu z osobna.
export default function Modal({
  title,
  onClose,
  children,
  foot,
  footStyle,
  className,
  ariaLabel,
  dirty,
}: {
  title?: ReactNode; // string → wyśrodkowany nagłówek z „grabberem"; pomiń, gdy panel ma własny head
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode; // stopka (np. przyciski) — renderowana tylko gdy podana
  footStyle?: CSSProperties; // styl .panel-foot (np. flex/gap), gdy stopka ma kilka przycisków
  className?: string; // dodatkowa klasa na .panel
  ariaLabel?: string; // gdy title nie jest tekstem — nazwa dla czytników ekranu
  dirty?: boolean; // opt-in: gdy true, klik w tło/Escape pyta o niezapisane zmiany
}): React.ReactElement {
  // Strażnik niezapisanych zmian (opt-in). Bez `dirty` zachowanie 1:1 jak dotąd.
  const guardedClose = useDirtyClose(!!dirty, onClose);
  const close = dirty ? guardedClose : onClose;
  useEscape(close);
  const label = ariaLabel ?? (typeof title === "string" ? title : undefined);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Przywróć fokus do elementu sprzed otwarcia (po zamknięciu) + PRZENIEŚ fokus do modala po otwarciu
  // (pierwsze pole albo sam panel) — dostępność klawiatury i czytnika ekranu.
  const prevFocus = useRef<Element | null>(null);
  useEffect(() => {
    prevFocus.current = typeof document !== "undefined" ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus?.();
    }
    return () => { try { (prevFocus.current as HTMLElement | null)?.focus?.(); } catch { /* ignore */ } };
  }, []);
  // Pułapka fokusu: Tab/Shift+Tab zawija WEWNĄTRZ modala (nie ucieka na tło = tło niedostępne z klawiatury).
  const onKeyDownTrap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => el.offsetParent !== null || el === panel);
    if (items.length === 0) { e.preventDefault(); return; }
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? items.indexOf(active) : -1;
    const next = nextTrapIndex(items.length, idx < 0 ? (e.shiftKey ? 0 : items.length - 1) : idx, e.shiftKey);
    if (next >= 0) { e.preventDefault(); items[next]?.focus?.(); }
  };
  return (
    <div className="sheet" onClick={close}>
      <div
        ref={panelRef}
        className={"panel" + (className ? " " + className : "")}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDownTrap}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {/* Przełącznik dokowania okna (⬅ ⬜ ➡) — tylko desktop; chowa się na wąskim ekranie. */}
        <DockSwitcher />
        {title != null && (
          <div className="panel-head">
            <div className="grabber" />
            <h2>{title}</h2>
          </div>
        )}
        <div className="panel-body">{children}</div>
        {foot != null && <div className="panel-foot" style={footStyle}>{foot}</div>}
      </div>
    </div>
  );
}
