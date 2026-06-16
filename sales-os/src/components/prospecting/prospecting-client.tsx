"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Radar,
  Loader2,
  Search,
  Globe,
  GlobeLock,
  Phone,
  Star,
  MapPin,
  Import,
  Wrench,
  Building2,
  Zap,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

interface Candidate {
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  hasWebsite: boolean;
  address?: string | null;
  city?: string | null;
  category?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  mapsUrl?: string | null;
  nip?: string | null;
  registeredAt?: string | null;
  signals: string[];
  source: string;
  sourceDetail: string;
}

interface SearchResponse {
  candidates: Candidate[];
  providerNames: string[];
  live: boolean;
  noWebsiteCount: number;
}

interface ProspectingSettings {
  prospectingEnabled: boolean;
  prospectingQueries: string[];
  prospectingNoWebsiteOnly: boolean;
  auditWebsites: boolean;
}

const CATEGORY_SUGGESTIONS = [
  "fryzjer", "kosmetyczka", "mechanik samochodowy", "dentysta", "restauracja",
  "hydraulik", "elektryk", "warsztat stolarski", "fizjoterapeuta", "kancelaria prawna",
];

function candidateKey(c: Candidate): string {
  return `${c.name}|${c.phone ?? ""}|${c.address ?? ""}`;
}

export function ProspectingClient({
  providers,
  stats,
  settings: initialSettings,
}: {
  providers: { name: string; live: boolean }[];
  stats: { importedTotal: number; noWebsiteTotal: number; modernizationTotal: number };
  settings: ProspectingSettings;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [noWebsiteOnly, setNoWebsiteOnly] = useState(true);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [autoAudit, setAutoAudit] = useState(true);
  const [autoDraft, setAutoDraft] = useState(true);
  const [importing, setImporting] = useState(false);

  const [settings, setSettings] = useState(initialSettings);
  const [newQuery, setNewQuery] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const live = providers.some((p) => p.live);

  async function runSearch() {
    if (category.trim().length < 2 || city.trim().length < 2) {
      toast.error("Enter a business category and a city");
      return;
    }
    setSearching(true);
    setResult(null);
    setSelected(new Set());
    try {
      const res = await fetch("/api/prospecting/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: category.trim(), city: city.trim(), limit: 20, noWebsiteOnly }),
      });
      if (!res.ok) throw new Error("Search failed");
      const data = (await res.json()) as SearchResponse;
      setResult(data);
      // Pre-select the best leads: businesses without a website.
      setSelected(new Set(data.candidates.filter((c) => !c.hasWebsite).map(candidateKey)));
    } catch {
      toast.error("Search failed — try again");
    } finally {
      setSearching(false);
    }
  }

  async function importSelected() {
    if (!result) return;
    const chosen = result.candidates.filter((c) => selected.has(candidateKey(c)));
    if (chosen.length === 0) {
      toast.error("Select at least one business");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/prospecting/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates: chosen, autoAudit, autoDraft }),
      });
      if (!res.ok) throw new Error("Import failed");
      const data = (await res.json()) as { created: number; deduped: number; audited: number };
      toast.success(
        `Imported ${data.created} lead${data.created === 1 ? "" : "s"}` +
          (data.deduped ? ` · ${data.deduped} duplicate(s) skipped` : "") +
          (data.audited ? ` · ${data.audited} website(s) audited` : ""),
      );
      setResult({
        ...result,
        candidates: result.candidates.filter((c) => !selected.has(candidateKey(c))),
      });
      setSelected(new Set());
      router.refresh();
    } catch {
      toast.error("Import failed — try again");
    } finally {
      setImporting(false);
    }
  }

  async function saveSettings(patch: Partial<ProspectingSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSavingSettings(true);
    try {
      const res = await fetch("/api/acquisition/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      toast.success("Autopilot prospecting settings saved");
    } catch {
      setSettings(settings);
      toast.error("Could not save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  function toggleAll() {
    if (!result) return;
    if (selected.size === result.candidates.length) setSelected(new Set());
    else setSelected(new Set(result.candidates.map(candidateKey)));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead Finder"
        description="Find local businesses with no website (or a weak one) on Google Maps and in business registries — phone numbers included."
      >
        <Badge variant={live ? "default" : "secondary"}>
          {live ? `Live: ${providers.filter((p) => p.live).map((p) => p.name).join(" + ")}` : "Sample data — add GOOGLE_PLACES_API_KEY"}
        </Badge>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Imported from Lead Finder" value={stats.importedTotal} icon={Import} />
        <KpiCard
          label="Leads without a website"
          value={stats.noWebsiteTotal}
          icon={GlobeLock}
          accent="success"
          hint="The easiest pitch — they need a site"
        />
        <KpiCard
          label="Modernization leads"
          value={stats.modernizationTotal}
          icon={Wrench}
          accent="warning"
          hint="Weak / slow / insecure websites"
        />
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="h-4 w-4" /> Search local businesses
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="pf-category">Business category</Label>
              <Input
                id="pf-category"
                list="pf-category-list"
                placeholder="e.g. fryzjer, mechanik, dentysta…"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
              />
              <datalist id="pf-category-list">
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-city">City</Label>
              <Input
                id="pf-city"
                placeholder="e.g. Warszawa"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={runSearch} disabled={searching} className="w-full sm:w-auto">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </Button>
            </div>
          </div>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border accent-primary"
              checked={noWebsiteOnly}
              onChange={(e) => setNoWebsiteOnly(e.target.checked)}
            />
            Only businesses without a website
          </label>
        </CardContent>
      </Card>

      {/* Results */}
      {searching ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching {live ? "live sources" : "sample data"}…
          </CardContent>
        </Card>
      ) : result ? (
        result.candidates.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No businesses found"
            description="Try a broader category, a different city, or disable the no-website filter."
          />
        ) : (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {result.candidates.length} found · {result.noWebsiteCount} without a website
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={toggleAll}>
                  {selected.size === result.candidates.length ? "Deselect all" : "Select all"}
                </Button>
                <Button size="sm" onClick={importSelected} disabled={importing || selected.size === 0}>
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Import className="h-4 w-4" />}
                  Import {selected.size} selected
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={autoAudit}
                    onChange={(e) => setAutoAudit(e.target.checked)}
                  />
                  Audit websites on import
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={autoDraft}
                    onChange={(e) => setAutoDraft(e.target.checked)}
                  />
                  AI first-touch draft → approvals
                </label>
              </div>

              <div className="divide-y divide-border rounded-lg border border-border">
                {result.candidates.map((c) => {
                  const key = candidateKey(c);
                  const checked = selected.has(key);
                  return (
                    <label
                      key={key}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-muted/40",
                        checked && "bg-primary/5",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-border accent-primary"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          setSelected(next);
                        }}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{c.name}</span>
                          {!c.hasWebsite ? (
                            <Badge className="bg-success/10 text-success border-success/20" variant="outline">
                              No website
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Has website</Badge>
                          )}
                          {c.registeredAt ? <Badge variant="secondary">New company</Badge> : null}
                          <Badge variant="outline" className="text-muted-foreground">
                            {c.sourceDetail}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {c.phone ? (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" /> {c.phone}
                            </span>
                          ) : null}
                          {c.rating != null ? (
                            <span className="flex items-center gap-1">
                              <Star className="h-3 w-3" /> {c.rating.toFixed(1)} ({c.reviewCount ?? 0})
                            </span>
                          ) : null}
                          {c.address ? (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {c.address}
                            </span>
                          ) : null}
                          {c.website ? (
                            <span className="flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              <span className="max-w-[220px] truncate">{c.website}</span>
                            </span>
                          ) : null}
                        </div>
                        {c.signals.length ? (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {c.signals.map((s) => (
                              <Badge key={s} variant="outline" className="text-[11px] text-warning border-warning/30">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )
      ) : (
        <EmptyState
          icon={Radar}
          title="Find businesses that need a website"
          description='Search "fryzjer" in "Warszawa" — Google Maps shows which businesses have no website, and CEIDG surfaces freshly registered companies.'
        />
      )}

      {/* Autopilot prospecting */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" /> Autopilot prospecting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The acquisition autopilot can run these searches automatically every tick and import what it
            finds — bounded by your daily lead cap.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-primary"
                checked={settings.prospectingEnabled}
                disabled={savingSettings}
                onChange={(e) => saveSettings({ prospectingEnabled: e.target.checked })}
              />
              Enable automatic prospecting
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-primary"
                checked={settings.prospectingNoWebsiteOnly}
                disabled={savingSettings}
                onChange={(e) => saveSettings({ prospectingNoWebsiteOnly: e.target.checked })}
              />
              Only import businesses without a website
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-primary"
                checked={settings.auditWebsites}
                disabled={savingSettings}
                onChange={(e) => saveSettings({ auditWebsites: e.target.checked })}
              />
              Auto-audit lead websites
            </label>
          </div>

          <div className="space-y-2">
            <Label>Saved searches (category @ city)</Label>
            <div className="flex flex-wrap gap-2">
              {settings.prospectingQueries.map((q) => (
                <Badge key={q} variant="secondary" className="gap-1 pr-1">
                  {q}
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-muted"
                    onClick={() =>
                      saveSettings({
                        prospectingQueries: settings.prospectingQueries.filter((x) => x !== q),
                      })
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {settings.prospectingQueries.length === 0 ? (
                <span className="text-xs text-muted-foreground">No saved searches yet.</span>
              ) : null}
            </div>
            <div className="flex max-w-md gap-2">
              <Input
                placeholder="fryzjer @ Warszawa"
                value={newQuery}
                onChange={(e) => setNewQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newQuery.includes("@")) {
                    saveSettings({ prospectingQueries: [...settings.prospectingQueries, newQuery.trim()] });
                    setNewQuery("");
                  }
                }}
              />
              <Button
                variant="outline"
                disabled={!newQuery.includes("@") || savingSettings}
                onClick={() => {
                  saveSettings({ prospectingQueries: [...settings.prospectingQueries, newQuery.trim()] });
                  setNewQuery("");
                }}
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
