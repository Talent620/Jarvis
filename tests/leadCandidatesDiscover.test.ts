// === discoverCandidates (leads) — testy (bez sieci) ===
// Samo wyszukanie nie zapisuje do CRM. Tu sprawdzamy deterministyczną ścieżkę bez sieci: brak
// miasta (i brak geolokalizacji w node) → uczciwy błąd, pusta lista, bez wyjątku i bez zapisu.
import { describe, it, expect, beforeEach } from "vitest";
import { discoverCandidates } from "../src/lib/leads";
import { store } from "../src/lib/store";

describe("discoverCandidates — brak miasta → brak sieci, brak zapisu", () => {
  beforeEach(() => {
    store.setSettings({ prospectLocation: "", prospectNiche: "" });
  });

  it("bez miasta i bez geolokalizacji → błąd, zero kandydatów, CRM nietknięty", async () => {
    const before = store.data.leads.length;
    const r = await discoverCandidates({});
    expect(r.error).toBeTruthy();
    expect(r.candidates).toHaveLength(0);
    expect(store.data.leads.length).toBe(before); // samo wyszukanie niczego nie zapisało
  });
});
