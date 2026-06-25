// === Projekty stron WWW — zapis / wczytanie / wersje (Kreator stron) ===
// Trwały zapis pełnego stanu strony (HTML + prompt + typ + styl + brief) do osobnej kolekcji
// `siteProjects` (IndexedDB, capped w store). Nieinwazyjne: nie rusza generacji ani innych danych.
// Obsługuje wiele projektów, historię wersji (przywracanie), eksport/import JSON.

import { store } from "./store";
import type { SiteProject } from "../types";

const MAX_VERSIONS = 6;

let seq = 0;
function genId(): string {
  seq += 1;
  return `sp_${seq}_${Math.round(performance.now?.() ?? 0)}`;
}

export function listSiteProjects(): SiteProject[] {
  return store.data.siteProjects || [];
}

export function getSiteProject(id: string): SiteProject | undefined {
  return listSiteProjects().find((p) => p.id === id);
}

export interface SiteProjectInput {
  id?: string; // brak → nowy projekt
  name: string;
  prompt?: string;
  kind?: string;
  style?: string;
  html: string;
  brief?: unknown;
}

/** Pure: zbuduj rekord projektu (upsert na istniejącym), dodając wersję, gdy HTML się zmienił. */
export function buildProjectRecord(existing: SiteProject | undefined, inp: SiteProjectInput, now: number, id: string): SiteProject {
  const versions = existing?.versions ? existing.versions.slice() : [];
  if (inp.html && existing?.html !== inp.html) {
    versions.unshift({ at: now, html: inp.html });
    if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
  }
  return {
    id,
    name: (inp.name || "").trim() || existing?.name || "Projekt",
    at: existing?.at || now,
    updatedAt: now,
    prompt: inp.prompt ?? existing?.prompt ?? "",
    kind: inp.kind ?? existing?.kind ?? "auto",
    style: inp.style ?? existing?.style ?? "auto",
    html: inp.html ?? existing?.html ?? "",
    brief: inp.brief ?? existing?.brief,
    versions,
  };
}

/** Zapisz/zaktualizuj projekt (upsert po id). Zwraca zapisany rekord (z id). */
export function saveSiteProject(inp: SiteProjectInput): SiteProject {
  const now = Date.now();
  const existing = inp.id ? getSiteProject(inp.id) : undefined;
  const rec = buildProjectRecord(existing, inp, now, existing?.id || genId());
  store.setData((d) => {
    if (!d.siteProjects) d.siteProjects = [];
    d.siteProjects = [rec, ...d.siteProjects.filter((p) => p.id !== rec.id)];
  });
  return rec;
}

export function renameSiteProject(id: string, name: string): void {
  const n = (name || "").trim();
  if (!n) return;
  store.setData((d) => {
    const p = (d.siteProjects || []).find((x) => x.id === id);
    if (p) { p.name = n; p.updatedAt = Date.now(); }
  });
}

export function removeSiteProject(id: string): void {
  store.setData((d) => { if (d.siteProjects) d.siteProjects = d.siteProjects.filter((p) => p.id !== id); });
}

/** Eksport projektu do JSON (kopia/przeniesienie). */
export function exportSiteProject(id: string): string {
  const p = getSiteProject(id);
  return p ? JSON.stringify(p, null, 2) : "";
}

/** Import projektu z JSON. Waliduje minimalnie, nadaje NOWE id (nie nadpisuje istniejących). */
export function importSiteProject(json: string): SiteProject | null {
  try {
    const o = JSON.parse(json) as Partial<SiteProject>;
    if (!o || typeof o.html !== "string" || !o.html.trim()) return null;
    return saveSiteProject({
      name: (typeof o.name === "string" && o.name) || "Import",
      prompt: typeof o.prompt === "string" ? o.prompt : "",
      kind: typeof o.kind === "string" ? o.kind : "auto",
      style: typeof o.style === "string" ? o.style : "auto",
      html: o.html,
      brief: o.brief,
    });
  } catch {
    return null;
  }
}
