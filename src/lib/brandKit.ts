// === Dusza Marki (Brand-kit) — spójna tożsamość wstrzykiwana do generatorów ===
// NIEINWAZYJNE: nie nadpisuje bazowych promptów. `appendBrand(system)` DOKLEJA blok marki do
// istniejącego system-promptu (stron/treści), `brandImageSuffix()` dokleja paletę/styl do promptu
// obrazu. Gdy brand-kit jest pusty — funkcje zwracają wejście bez zmian (zero wpływu na starą ścieżkę).
// Czyste i testowalne; I/O przez store.

import { store } from "./store";
import type { BrandKit } from "../types";

export type { BrandKit };

export function loadBrandKit(): BrandKit {
  return store.settings.brandKit || {};
}

export function saveBrandKit(b: BrandKit): void {
  store.setSettings({ brandKit: b });
}

/** Czy marka ma cokolwiek ustawione (warunek wstrzykiwania). */
export function hasBrandKit(b: BrandKit = loadBrandKit()): boolean {
  return !!(b.name || b.tagline || b.voice || b.audience || b.colors || b.fonts || b.keywords || b.avoid);
}

/** Pure: blok tożsamości marki dla generatorów TEKSTU/STRON (PL). Pusty, gdy brak marki. */
export function brandContextBlock(b: BrandKit = loadBrandKit()): string {
  if (!hasBrandKit(b)) return "";
  const rows: [string | undefined, string][] = [
    [b.name, "Marka"],
    [b.tagline, "Hasło"],
    [b.voice, "Ton głosu"],
    [b.audience, "Grupa docelowa"],
    [b.colors, "Kolory marki"],
    [b.fonts, "Typografia"],
    [b.keywords, "Słowa kluczowe / styl"],
    [b.avoid, "Czego unikać"],
  ];
  const lines = rows.filter(([v]) => v && v.trim()).map(([v, k]) => `${k}: ${v!.trim()}`);
  return [
    "TOŻSAMOŚĆ MARKI (zachowaj BEZWZGLĘDNĄ spójność: stosuj te kolory, typografię, ton głosu i słownictwo konsekwentnie w całej treści):",
    ...lines,
  ].join("\n");
}

/** Pure: dolej blok marki do istniejącego system-promptu (rozszerzenie, nie nadpisanie). */
export function appendBrand(system: string, b: BrandKit = loadBrandKit()): string {
  const block = brandContextBlock(b);
  return block ? `${system}\n\n${block}` : system;
}

/** Pure: krótki dodatek do promptu OBRAZU (paleta + styl marki). Pusty, gdy brak marki. */
export function brandImageSuffix(b: BrandKit = loadBrandKit()): string {
  if (!hasBrandKit(b)) return "";
  const bits = [
    b.colors && `paleta marki: ${b.colors.trim()}`,
    b.keywords && `styl: ${b.keywords.trim()}`,
  ].filter(Boolean);
  return bits.length ? ` — spójnie z marką (${bits.join("; ")})` : "";
}
