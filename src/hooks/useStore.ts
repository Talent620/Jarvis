import { useSyncExternalStore } from "react";
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
