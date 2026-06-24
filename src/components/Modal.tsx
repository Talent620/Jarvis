import type { CSSProperties, ReactNode } from "react";
import { useEscape } from "../hooks/useEscape";

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
}: {
  title?: ReactNode; // string → wyśrodkowany nagłówek z „grabberem"; pomiń, gdy panel ma własny head
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode; // stopka (np. przyciski) — renderowana tylko gdy podana
  footStyle?: CSSProperties; // styl .panel-foot (np. flex/gap), gdy stopka ma kilka przycisków
  className?: string; // dodatkowa klasa na .panel
  ariaLabel?: string; // gdy title nie jest tekstem — nazwa dla czytników ekranu
}): React.ReactElement {
  useEscape(onClose);
  const label = ariaLabel ?? (typeof title === "string" ? title : undefined);
  return (
    <div className="sheet" onClick={onClose}>
      <div
        className={"panel" + (className ? " " + className : "")}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
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
