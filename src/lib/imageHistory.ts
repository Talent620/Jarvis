// === Historia przeróbek — Studio Obrazów ===
// Zapisuje WYNIKI edycji (base64) do trwałej historii (IndexedDB, capped w store), żeby nie
// znikały po zamknięciu Studia. Możesz je podejrzeć, pobrać albo wziąć do dalszej edycji.
// Nieinwazyjne: osobna kolekcja `imageHistory`, nie rusza istniejących ścieżek generacji.

import { store } from "./store";
import type { ImageEdit } from "../types";

type Img = { data: string; mediaType: string };

let seq = 0;
function genId(): string {
  seq += 1;
  return `img_${seq}_${Math.round(performance.now?.() ?? 0)}`;
}

/** Lista historii (najnowsze pierwsze). */
export function listImageHistory(): ImageEdit[] {
  return store.data.imageHistory || [];
}

/** Zapisz wynik przeróbki na początku historii. Pomija duplikat identyczny z ostatnim. */
export function saveImageEdit(img: Img, prompt?: string): void {
  if (!img?.data) return;
  store.setData((d) => {
    if (!d.imageHistory) d.imageHistory = [];
    if (d.imageHistory[0]?.data === img.data) return; // ten sam obraz tuż po sobie — nie dubluj
    d.imageHistory.unshift({ id: genId(), at: Date.now(), data: img.data, mediaType: img.mediaType || "image/png", prompt: (prompt || "").trim().slice(0, 300) || undefined });
  });
}

/** Usuń jedną pozycję po id. */
export function removeImageEdit(id: string): void {
  store.setData((d) => { if (d.imageHistory) d.imageHistory = d.imageHistory.filter((x) => x.id !== id); });
}

/** Wyczyść całą historię przeróbek. */
export function clearImageHistory(): void {
  store.setData((d) => { d.imageHistory = []; });
}
