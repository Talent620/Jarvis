// === Zunifikowany rejestr źródeł leadów (leadSources) ===
// Jeden kontrakt provenance dla WSZYSTKICH źródeł (OSM/Tavily/CEIDG/Google Places/mock). OSM jest
// darmowym fallbackiem offline-first. UI pokazuje uczciwie, które źródło jest LIVE / FALLBACK / SAMPLE
// / NIEDOSTĘPNE — bez udawania, że coś działa. Klucze są WPISYWANE przez użytkownika lokalnie (nie
// zaszyte w kodzie); status liczymy z konfiguracji. Nie dubluje implementacji Google (Sales OS/main).
// Czyste i testowalne. S9-safe.

import type { CandidateSource } from "./leadCandidates";

export type SourceStatus = "live" | "fallback" | "sample" | "unavailable";

export interface LeadSourceInfo {
  id: CandidateSource;
  label: string;
  status: SourceStatus;
  free: boolean;
  note: string;
}

export interface SourcesConfig {
  online: boolean;
  tavilyKey?: string;
  googlePlacesKey?: string;
  /** CEIDG podłączone (adapter sieciowy). Domyślnie false → uczciwie „niedostępne". */
  ceidgReady?: boolean;
}

/**
 * Pure: opisz stan wszystkich źródeł. OSM = darmowy fallback offline-first (live gdy online).
 * Płatne/klucze: live tylko przy kluczu I online. CEIDG: live tylko gdy adapter podłączony. Mock = sample.
 */
export function describeLeadSources(cfg: SourcesConfig): LeadSourceInfo[] {
  const online = !!cfg.online;
  const has = (k?: string) => !!(k && k.trim());
  return [
    {
      id: "osm", label: "OpenStreetMap", free: true,
      status: online ? "live" : "unavailable",
      note: online ? "Darmowe, bez klucza — źródło podstawowe (fallback offline-first)." : "Wymaga internetu.",
    },
    {
      id: "tavily", label: "Tavily (sieć)", free: false,
      status: has(cfg.tavilyKey) ? (online ? "live" : "unavailable") : "unavailable",
      note: has(cfg.tavilyKey) ? "Klucz obecny — łapie firmy spoza OSM." : "Dodaj klucz Tavily, by włączyć.",
    },
    {
      id: "google_places", label: "Google Places", free: false,
      status: has(cfg.googlePlacesKey) ? (online ? "live" : "unavailable") : "unavailable",
      note: has(cfg.googlePlacesKey) ? "Klucz obecny — trwale zapisujemy tylko placeId (polityka Google)." : "Dodaj klucz Google Places, by włączyć.",
    },
    {
      id: "ceidg", label: "CEIDG (rejestr)", free: true,
      status: cfg.ceidgReady ? (online ? "live" : "unavailable") : "unavailable",
      note: cfg.ceidgReady ? "Rejestr działalności — provenance: ceidg." : "Adapter CEIDG niepodłączony — nie udajemy, że działa.",
    },
    {
      id: "mock", label: "Przykładowe (demo)", free: true,
      status: "sample",
      note: "Dane przykładowe — nie importuj jako prawdziwe (no_persist).",
    },
  ];
}

const ICON: Record<SourceStatus, string> = { live: "🟢", fallback: "🟡", sample: "🧪", unavailable: "⚪" };

/** Pure: krótka etykieta źródła do UI (ikona + nazwa). */
export function sourceBadge(info: LeadSourceInfo): string {
  return `${ICON[info.status]} ${info.label}`;
}

/** Pure: które źródła są realnie użyteczne teraz (live)? */
export function liveSources(cfg: SourcesConfig): CandidateSource[] {
  return describeLeadSources(cfg).filter((s) => s.status === "live").map((s) => s.id);
}
