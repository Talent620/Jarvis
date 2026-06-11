import { useEffect } from "react";

/**
 * Zamykanie paneli klawiszem Escape (desktop/klawiatura) — każdy arkusz „sheet"
 * podpina ten hook, żeby zachowywać się jak natywne okno.
 */
export function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
