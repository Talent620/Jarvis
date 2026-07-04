import type { AuditEntry } from "../types";

// Podgląd dziennika audytu — czyste, testowalne funkcje filtrowania i statystyk.
// Pokazują, co realnie przeszło przez program (jakie akcje/narzędzia, kiedy, z jakim
// skutkiem). Wszystko lokalnie — dane nie opuszczają urządzenia.

export type AuditStatus = "all" | "ok" | "error" | "denied";
export interface AuditFilter { q?: string; status?: AuditStatus; }

/** Jedna linia wejścia (obiekt narzędzia) do podglądu w tabeli. */
export function inputPreview(input: unknown, max = 100): string {
  if (input == null) return "";
  let s: string;
  try { s = typeof input === "string" ? input : JSON.stringify(input); }
  catch { s = String(input); }
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Filtr po treści (narzędzie + wejście + wynik) i statusie. */
export function filterAudit(entries: AuditEntry[], f: AuditFilter = {}): AuditEntry[] {
  const q = (f.q || "").trim().toLowerCase();
  const status = f.status || "all";
  return entries.filter((e) => {
    if (status !== "all" && e.status !== status) return false;
    if (!q) return true;
    const hay = `${e.tool} ${inputPreview(e.input, 9999)} ${e.output || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export interface AuditStats { total: number; ok: number; error: number; denied: number; }

/** Liczniki do nagłówka. */
export function auditStats(entries: AuditEntry[]): AuditStats {
  return {
    total: entries.length,
    ok: entries.filter((e) => e.status === "ok").length,
    error: entries.filter((e) => e.status === "error").length,
    denied: entries.filter((e) => e.status === "denied").length,
  };
}
