// === Rejestr „umiejętności" (skills) — modułowe rozszerzanie BEZ ruszania rdzenia ===
// Umiejętność = nazwany PAKIET narzędzi + metadane. Pozwala dodać spójną zdolność (np. „Krypto"
// z 3 narzędziami) jednym wywołaniem, wylistować ją (UI/introspekcja), bezpiecznie przeładować
// (idempotentnie) i wyłączyć (disposer). Rdzeń pozostaje nietknięty — skille dokładają się przez
// publiczne API registerTool/unregisterTool, więc model widzi je natychmiast (te same toolDefs).
import { registerTool, unregisterTool, type ToolDef, type Executor } from "./tools";

export interface SkillTool { def: ToolDef; run: Executor }
export interface SkillManifest {
  id: string;
  title: string;
  version?: string;
  description?: string;
  tools: SkillTool[];
}

const registered = new Map<string, SkillManifest>();

/**
 * Zarejestruj umiejętność (pakiet narzędzi). Idempotentne: ponowna rejestracja tego samego `id`
 * najpierw sprząta starą wersję (hot-reload-safe). Zwraca disposer do wyłączenia.
 */
export function registerSkill(m: SkillManifest): () => void {
  if (!m.id || !m.tools?.length) throw new Error("Umiejętność wymaga id i przynajmniej jednego narzędzia.");
  if (registered.has(m.id)) unregisterSkill(m.id);
  for (const t of m.tools) registerTool(t.def, t.run, { replace: true });
  registered.set(m.id, m);
  return () => unregisterSkill(m.id);
}

/** Wyłącz umiejętność i wyrejestruj jej narzędzia (rdzeń nietknięty). */
export function unregisterSkill(id: string): boolean {
  const m = registered.get(id);
  if (!m) return false;
  for (const t of m.tools) unregisterTool(t.def.name);
  registered.delete(id);
  return true;
}

/** Lista aktywnych umiejętności (do UI/introspekcji). */
export function listSkills(): { id: string; title: string; version?: string; toolCount: number }[] {
  return [...registered.values()].map((m) => ({ id: m.id, title: m.title, version: m.version, toolCount: m.tools.length }));
}

/** Czy umiejętność jest aktywna. */
export function hasSkill(id: string): boolean {
  return registered.has(id);
}
