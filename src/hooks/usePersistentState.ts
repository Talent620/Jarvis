import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { readDraft, writeDraft, clearDraft } from "../lib/draftStore";

// Drop-in zamiennik useState, który PRZEŻYWA odmontowanie panelu i zamknięcie aplikacji:
// stan roboczy jest lustrzany do localStorage (draftStore) i odtwarzany przy powrocie —
// synchronicznie w pierwszym renderze (bez mignięcia pustego pola). Dzięki temu „sesja funkcji"
// (budowana strona, szkic reklamy/maila, wpisany tekst czatu…) nie ginie po wyjściu z funkcji.
//
// Użycie identyczne jak useState, tylko z NAZWĄ szkicu jako pierwszym argumentem:
//   const [html, setHtml] = usePersistentState("webstudio.html", "");
// Nazwa musi być STAŁA i UNIKALNA w obrębie aplikacji (namespacing robi draftStore).

export function usePersistentState<T>(
  name: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  // Leniwa inicjalizacja: najpierw próbujemy odtworzyć szkic, dopiero potem wartość domyślna.
  const [state, setState] = useState<T>(() => {
    const fallback = typeof initial === "function" ? (initial as () => T)() : initial;
    return readDraft(name, fallback);
  });
  // Nazwa nie powinna się zmieniać w cyklu życia — trzymamy ją stabilnie (gdyby jednak: zapisujemy
  // pod aktualną, nie odtwarzamy w locie, by nie mieszać szkiców).
  const nameRef = useRef(name);
  nameRef.current = name;
  useEffect(() => {
    writeDraft(nameRef.current, state);
  }, [state]);
  return [state, setState];
}

/** Wyczyść szkic pod daną nazwą (np. po realnym zapisaniu/wysłaniu — żeby nie odtwarzać ukończonego). */
export function clearPersistentDraft(name: string): void {
  clearDraft(name);
}
