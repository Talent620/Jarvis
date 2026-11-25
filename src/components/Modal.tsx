import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useEscape } from "../hooks/useEscape";
import { useDirtyClose } from "../hooks/useDirtyClose";
import { FOCUSABLE_SELECTOR, nextTrapIndex } from "../lib/a11y";

let activeSheetCount = 0;

/**
 * Wspólna, jedyna implementacja pułapki i przywracania fokusu dla <Modal> oraz starszych arkuszy .sheet.
 * - Po otwarciu przenosi fokus do pierwszego elementu interaktywnego (lub samego panelu).
 * - Tab / Shift+Tab zawijają fokus wewnątrz aktywnego okna dialogowego.
 * - Po zamknięciu przywraca fokus do elementu wywołującego sprzed otwarcia.
 * - Utrzymuje klasę `body.sheet-open`, aby dymki `.toast` nie zasłaniały nagłówka ani przycisku `×`.
 */
export function useModalFocusTrap() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const prevFocus = useRef<Element | null>(null);
  const capturedPrev = useRef(false);

  const trapTabEvent = useCallback((e: { key: string; shiftKey: boolean; defaultPrevented: boolean; preventDefault: () => void }) => {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (typeof document !== "undefined") {
      const dialogs = document.querySelectorAll<HTMLElement>('.sheet [role="dialog"]');
      if (dialogs.length > 1 && dialogs[dialogs.length - 1] !== panel) return;
    }
    const hasLayout = panel.offsetParent !== null || panel.getClientRects().length > 0;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
      if (el.closest("[hidden], [aria-hidden='true']")) return false;
      if (el === panel) return true;
      if (!hasLayout) return true;
      return el.offsetParent !== null || el.getClientRects().length > 0;
    });
    if (items.length === 0) {
      e.preventDefault();
      panel.focus?.();
      return;
    }
    const active = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;
    const idx = active ? items.indexOf(active) : -1;
    const next =
      idx < 0
        ? (e.shiftKey ? items.length - 1 : 0)
        : nextTrapIndex(items.length, idx, e.shiftKey);
    if (next >= 0) {
      e.preventDefault();
      items[next]?.focus?.();
    }
  }, []);

  const setPanelRef = useCallback((panel: HTMLDivElement | null) => {
    const previous = panelRef.current;
    panelRef.current = panel;
    if (panel && panel !== previous) {
      if (!capturedPrev.current && typeof document !== "undefined") {
        capturedPrev.current = true;
        prevFocus.current = document.activeElement;
      }
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus?.();
    }
  }, []);

  useEffect(() => {
    if (!capturedPrev.current && typeof document !== "undefined") {
      capturedPrev.current = true;
      prevFocus.current = document.activeElement;
    }
    const tracked = typeof document !== "undefined";
    if (tracked) {
      activeSheetCount += 1;
      document.body.classList.add("sheet-open");
    }
    const panel = panelRef.current;
    if (panel && typeof document !== "undefined" && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus?.();
    }
    const onDocKeyDown = (ev: KeyboardEvent) => trapTabEvent(ev);
    if (tracked) document.addEventListener("keydown", onDocKeyDown, true);
    return () => {
      if (tracked) document.removeEventListener("keydown", onDocKeyDown, true);
      capturedPrev.current = false;
      if (tracked) {
        activeSheetCount = Math.max(0, activeSheetCount - 1);
        if (activeSheetCount === 0) document.body.classList.remove("sheet-open");
      }
      try {
        const prev = prevFocus.current as HTMLElement | null;
        if (prev && (typeof document === "undefined" || document.contains(prev))) {
          prev.focus?.();
        }
      } catch { /* ignore */ }
    };
  }, [trapTabEvent]);

  const onKeyDownTrap = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => trapTabEvent(e),
    [trapTabEvent],
  );

  return {
    ref: setPanelRef,
    onKeyDown: onKeyDownTrap,
    tabIndex: -1 as const,
  };
}

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
  const dialogTrap = useModalFocusTrap();
  return (
    <div className="sheet" onClick={close}>
      <div
        {...dialogTrap}
        className={"panel" + (className ? " " + className : "")}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {title != null && (
          <div className="panel-head">
            <div className="grabber" />
            <div className="panel-head-row">
              <h2>{title}</h2>
              <button type="button" className="panel-close" onClick={close} aria-label="Zamknij" title="Zamknij (Esc)">×</button>
            </div>
          </div>
        )}
        <div className="panel-body">{children}</div>
        {foot != null && <div className="panel-foot" style={footStyle}>{foot}</div>}
      </div>
    </div>
  );
}
