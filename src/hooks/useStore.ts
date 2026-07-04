import { useRef, useSyncExternalStore } from "react";
import { store } from "../lib/store";

// Re-renderuje komponent przy każdej zmianie magazynu (dane + ustawienia).
// Snapshotem jest licznik wersji, bo dane mutowane są w miejscu.
export function useStore() {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.version,
  );
  return { data: store.data, settings: store.settings };
}

/**
 * Pure: zwróć poprzedni snapshot (stabilna referencja), gdy wartość się NIE zmieniła wg `isEqual`,
 * albo nowy. Kluczowe dla useSyncExternalStore: getSnapshot MUSI zwracać stabilną referencję, gdy
 * nic się nie zmieniło — inaczej selektory zwracające obiekty/tablice powodują pętlę re-renderów.
 */
export function nextSnapshot<T>(prev: { value: T } | null, next: T, isEqual: (a: T, b: T) => boolean): { value: T } {
  if (prev && isEqual(prev.value, next)) return prev;
  return { value: next };
}

/** Pure: płytkie porównanie obiektów/tablic (do selektorów zwracających złożone wartości). */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/**
 * Subskrypcja do PLASTERKA stanu — komponent re-renderuje się TYLKO, gdy wybrana wartość się
 * zmieni (wg `isEqual`, domyślnie Object.is). Mniej re-renderów niż globalne `useStore()`.
 *
 * UWAGA: kolekcje `store.data.*` są mutowane W MIEJSCU (stała referencja tablicy), więc selektor
 * `() => store.data.tasks` NIE wykryje zmiany — wybieraj wartości POCHODNE (np. `tasks.length`,
 * policzone KPI) albo zwróć nową tablicę i przekaż `shallowEqual`. `store.settings` jest
 * podmieniane na nowy obiekt przy każdej zmianie, więc selektory ustawień działają z Object.is.
 */
export function useStoreSelector<T>(selector: () => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const ref = useRef<{ value: T } | null>(null);
  const getSnapshot = () => {
    ref.current = nextSnapshot(ref.current, selector(), isEqual);
    return ref.current.value;
  };
  return useSyncExternalStore((cb) => store.subscribe(cb), getSnapshot);
}
