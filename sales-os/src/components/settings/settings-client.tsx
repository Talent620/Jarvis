"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, ShieldCheck, Plug, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface Integration {
  id: string;
  type: string;
  provider: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
}

interface CompanyData {
  name: string;
  industry: string | null;
  website: string | null;
  timezone: string;
  currency: string;
  aiContext: string | null;
  integrations: Integration[];
  _count: { users: number; leads: number };
}

const CURRENCIES = ["PLN", "EUR", "USD", "GBP"];
const TIMEZONES = [
  "Europe/Warsaw",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Berlin",
  "America/New_York",
  "UTC",
];

function label(s: string) {
  return s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive"> = {
  CONNECTED: "success",
  DISCONNECTED: "secondary",
  ERROR: "destructive",
};

export function SettingsClient({ company }: { company: CompanyData }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: company.name,
    industry: company.industry ?? "",
    website: company.website ?? "",
    timezone: company.timezone,
    currency: company.currency,
    aiContext: company.aiContext ?? "",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          industry: form.industry.trim() || null,
          website: form.website.trim() || null,
          timezone: form.timezone,
          currency: form.currency,
          aiContext: form.aiContext.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Settings saved");
      router.refresh();
    } catch {
      toast.error("Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company profile</CardTitle>
          <CardDescription>
            Used across the app and as context for AI generation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Company name</Label>
              <Input
                id="s-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-industry">Industry</Label>
              <Input
                id="s-industry"
                value={form.industry}
                onChange={(e) => set("industry", e.target.value)}
                placeholder="e.g. Trade fairs & exhibitions"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-website">Website</Label>
              <Input
                id="s-website"
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-currency">Currency</Label>
                <select
                  id="s-currency"
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-tz">Timezone</Label>
                <select
                  id="s-tz"
                  value={form.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {TIMEZONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-context">AI context</Label>
            <Textarea
              id="s-context"
              value={form.aiContext}
              onChange={(e) => set("aiContext", e.target.value)}
              rows={4}
              placeholder="Describe what you sell, your tone of voice, and your ideal customer. The AI uses this in every draft."
            />
            <p className="text-xs text-muted-foreground">
              This is injected into every AI prompt to keep output on-brand.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4 text-muted-foreground" />
            Integrations
          </CardTitle>
          <CardDescription>
            Connect an AI provider for live generation. Without one, the app runs on
            the built-in mock engine.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {company.integrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No integrations configured. Set AI_PROVIDER and AI_API_KEY in your
              environment to enable live AI.
            </p>
          ) : (
            company.integrations.map((i) => (
              <div
                key={i.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium">{label(i.provider)}</p>
                  <p className="text-xs text-muted-foreground">{label(i.type)}</p>
                </div>
                <Badge variant={STATUS_VARIANT[i.status]}>{label(i.status)}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Privacy &amp; data (GDPR / RODO)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            This workspace holds{" "}
            <span className="font-medium text-foreground">
              {company._count.leads} leads
            </span>{" "}
            and{" "}
            <span className="font-medium text-foreground">
              {company._count.users} users
            </span>
            .
          </p>
          <Separator />
          <ul className="list-inside list-disc space-y-1.5">
            <li>Leads are soft-deleted, keeping an auditable trail before purge.</li>
            <li>Every AI action is recorded in an immutable decision log.</li>
            <li>No message is ever sent without explicit human approval.</li>
            <li>Lead data is sanitised before being passed to any AI provider.</li>
          </ul>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
            <Database className="h-4 w-4 shrink-0" />
            Data export and right-to-erasure endpoints are part of the roadmap — see
            the README.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
