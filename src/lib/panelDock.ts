// === Dokowanie paneli (panelDock) — okna „w bok" na szerokim ekranie (EXE/desktop) ===
// PO CO: na monitorze panel (Ustawienia, CRM, Kreator…) otwierał się jako wąskie okno na ŚRODKU
// i nie dało się go przesunąć — marnował szeroki ekran i zasłaniał wszystko. Teraz można go
// ZADOKOWAĆ do lewej lub prawej krawędzi (pełnowysoka szuflada), albo zostawić na środku.
// Ta warstwa jest CZYSTA: mapuje wybór na klasę <body>, którą CSS zamienia na układ. Testowalne.
// S9-safe. Na wąskich ekranach (telefon) dokowanie jest ignorowane — sheet i tak jest pełnej szerokości.

export type PanelDock = "center" | "left" | "right";

export const DOCK_OPTIONS: { id: PanelDock; label: string; icon: string; hint: string }[] = [
  { id: "left", label: "Lewo", icon: "⬅", hint: "Zadokuj panel do lewej krawędzi" },
  { id: "center", label: "Środek", icon: "⬜", hint: "Panel na środku (domyślnie)" },
  { id: "right", label: "Prawo", icon: "➡", hint: "Zadokuj panel do prawej krawędzi" },
];

/** Pure: znormalizuj wartość dokowania (odporność na śmieci w ustawieniach). */
export function normalizeDock(v: unknown): PanelDock {
  return v === "left" || v === "right" ? v : "center";
}

/** Pure: klasa <body> dla wybranego dokowania. „center" → brak klasy (układ domyślny). */
export function dockBodyClass(dock: PanelDock): string {
  const d = normalizeDock(dock);
  return d === "center" ? "" : `dock-${d}`;
}

/** Wszystkie możliwe klasy dokowania — do czyszczenia body przed nałożeniem aktualnej. */
export const DOCK_CLASSES = ["dock-left", "dock-right"] as const;

/** Pure: następne dokowanie w cyklu lewo → środek → prawo → lewo (do jednego przycisku-przełącznika). */
export function cycleDock(dock: PanelDock): PanelDock {
  const order: PanelDock[] = ["left", "center", "right"];
  const i = order.indexOf(normalizeDock(dock));
  return order[(i + 1) % order.length];
}
