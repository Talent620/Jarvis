import type { Tip } from "../lib/tips";

// 💡 Nienachalny dymek-porada nad polem pisania: tekst + (opcjonalnie) przycisk akcji + ✕.
export default function TipBubble({ tip, onAction, onDismiss }: {
  tip: Tip;
  onAction: (actionId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="tip-bubble" role="status">
      <span className="tip-text">{tip.text}</span>
      {tip.actionId && tip.actionLabel && (
        <button className="tip-action" onClick={() => onAction(tip.actionId!)}>{tip.actionLabel}</button>
      )}
      <button className="tip-x" onClick={onDismiss} aria-label="Zamknij poradę" title="Nie pokazuj tej">✕</button>
    </div>
  );
}
