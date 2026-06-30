// Ochrona niezapisanej pracy: gdy formularz jest „brudny" (są niezapisane zmiany),
// zamknięcie przez kliknięcie w tło / Escape wymaga potwierdzenia. Czysta decyzja
// (confirmDiscardClose) jest testowalna; hook tylko spina ją z window.confirm.

/**
 * Pure: czy wolno zamknąć? Czysty formularz → tak. Brudny → pytamy (confirm zwraca decyzję).
 * Dzięki rozdzieleniu logiki od UI łatwo to testować bez DOM.
 */
export function confirmDiscardClose(dirty: boolean, confirm: () => boolean): boolean {
  if (!dirty) return true;
  return confirm();
}

const DEFAULT_MSG = "Masz niezapisane zmiany. Zamknąć i odrzucić wersję roboczą?";

/** Zwraca strażnika zamknięcia: przy brudnym formularzu pyta, zanim wywoła onClose. */
export function useDirtyClose(dirty: boolean, onClose: () => void, message = DEFAULT_MSG): () => void {
  return () => {
    const ok = confirmDiscardClose(dirty, () =>
      typeof window !== "undefined" ? window.confirm(message) : true,
    );
    if (ok) onClose();
  };
}
