"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  Magnet,
  Webhook,
  Copy,
  Check,
  Radar,
  Loader2,
  Globe,
  Inbox,
  Search,
  Zap,
  Power,
  Gauge,
  Clock,
  Send,
  Users,
  Play,
  GitBranch,
  Star,
  Plus,
  ShieldCheck,
} from "lucide-react";
import type { CampaignChannel, ContentKind, LeadSource, ScoreGrade } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { ScoreBadge } from "@/components/score-badge";
import { SourceBadge } from "@/components/status-badges";
import { cn } from "@/lib/utils";

const AUTO = "AUTO";
const WEBHOOK_PROVIDERS = ["meta", "google", "typeform", "tally", "calendly", "zapier"];
const CHANNEL_OPTIONS: CampaignChannel[] = ["EMAIL", "LINKEDIN", "FACEBOOK", "INSTAGRAM", "COLD_CALL"];

interface Audience {
  id: string;
  name: string;
  industry: string | null;
  region: string | null;
}

interface RecentLead {
  id: string;
  name: string;
  companyName: string | null;
  source: LeadSource;
  score: number;
  grade: ScoreGrade;
  createdAt: string;
}

export interface AutopilotSettings {
  enabled: boolean;
  cadenceMinutes: number;
  dailyLeadCap: number;
  targetPerDay: number;
  perRunBatch: number;
  autoDraftInbound: boolean;
  autoDraftOutbound: boolean;
  autoEnroll: boolean;
  enrichLeads: boolean;
  minScoreToDraft: number;
  channels: string[];
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  autoSendEmails: boolean;
  dailyEmailCap: number;
  auditWebsites: boolean;
  lastRunAt: string | null;
}

export interface RunRow {
  id: string;
  trigger: string;
  status: string;
  discovered: number;
  created: number;
  deduped: number;
  enriched: number;
  drafted: number;
  enrolled: number;
  advanced: number;
  hotDetected: number;
  durationMs: number;
  error: string | null;
  createdAt: string;
  detail: { reason?: string; live?: boolean } | null;
}

export interface SequenceStepRow {
  id: string;
  order: number;
  dayOffset: number;
  channel: CampaignChannel;
  kind: ContentKind;
  name: string;
}

export interface SequenceRow {
  id: string;
  name: string;
  description: string | null;
  channel: CampaignChannel;
  active: boolean;
  isDefault: boolean;
  steps: SequenceStepRow[];
  activeEnrollments: number;
  enrollments: number;
}

interface Stats {
  capturedToday: number;
  pendingApprovals: number;
  activeEnrollments: number;
  inbound: number;
  outbound: number;
}

export function AcquisitionClient({
  token,
  autoDraft: initialAutoDraft,
  baseUrl,
  audiences,
  provider,
  recent,
  settings,
  runs,
  sequences,
  stats,
}: {
  token: string;
  autoDraft: boolean;
  baseUrl: string;
  audiences: Audience[];
  provider: { name: string; live: boolean };
  recent: RecentLead[];
  settings: AutopilotSettings;
  runs: RunRow[];
  sequences: SequenceRow[];
  stats: Stats;
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState(baseUrl);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!baseUrl && typeof window !== "undefined") setOrigin(window.location.origin);
  }, [baseUrl]);

  const captureUrl = `${origin || "https://your-app.example"}/api/public/leads`;

  async function toggleEnabled(next: boolean) {
    setEnabled(next);
    try {
      const res = await fetch("/api/acquisition/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? "Autopilot is on — it’ll source & draft on a schedule" : "Autopilot paused");
      router.refresh();
    } catch {
      setEnabled(!next);
      toast.error("Could not update autopilot");
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/acquisition/run", { method: "POST" });
      if (!res.ok) throw new Error();
      const r: {
        status: string;
        created: number;
        drafted: number;
        enrolled: number;
        advanced: number;
        skippedReason?: string;
      } = await res.json();
      if (r.status === "SKIPPED") {
        toast.info(`Skipped — ${r.skippedReason ?? "nothing to do right now"}`);
      } else {
        const bits = [
          r.created ? `${r.created} new` : "",
          r.drafted ? `${r.drafted} drafted` : "",
          r.enrolled ? `${r.enrolled} enrolled` : "",
          r.advanced ? `${r.advanced} advanced` : "",
        ].filter(Boolean);
        toast.success(bits.length ? `Autopilot: ${bits.join(" · ")}` : "Autopilot ran — nothing new this pass");
      }
      router.refresh();
    } catch {
      toast.error("Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acquisition Autopilot"
        description="A self-driving engine that sources prospects from your ICP, enriches them, and drafts every outreach into Approvals — on a schedule. Nothing is ever sent without you."
      >
        <StatusPill enabled={enabled} live={provider.live} />
        <Button onClick={runNow} disabled={running}>
          {running ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
          Run now
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon={Magnet}
          label="Captured today"
          value={`${stats.capturedToday}/${settings.dailyLeadCap}`}
          sub={`target ${settings.targetPerDay}/day`}
        />
        <StatTile icon={Send} label="Drafts to review" value={stats.pendingApprovals} sub="in Approvals" accent={stats.pendingApprovals > 0} />
        <StatTile icon={Users} label="In sequences" value={stats.activeEnrollments} sub="active enrollments" />
        <NextRunTile enabled={enabled} lastRunAt={settings.lastRunAt} cadenceMinutes={settings.cadenceMinutes} />
      </div>

      <Tabs defaultValue="autopilot" className="space-y-5">
        <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTrigger value="autopilot">Autopilot</TabsTrigger>
          <TabsTrigger value="sequences">
            Sequences
            {sequences.length ? <span className="ml-1.5 text-xs text-muted-foreground">{sequences.length}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="inbound">Inbound</TabsTrigger>
          <TabsTrigger value="outbound">Outbound</TabsTrigger>
        </TabsList>

        <TabsContent value="autopilot" className="space-y-5">
          <EnginePanel enabled={enabled} onToggle={toggleEnabled} settings={settings} onSaved={() => router.refresh()} />
          <RunsFeed runs={runs} />
          <RecentlyCaptured recent={recent} />
        </TabsContent>

        <TabsContent value="sequences" className="space-y-5">
          <SequencesPanel sequences={sequences} onChange={() => router.refresh()} />
        </TabsContent>

        <TabsContent value="inbound" className="space-y-5">
          <InboundCard
            token={token}
            captureUrl={captureUrl}
            origin={origin || "https://your-app.example"}
            initialAutoDraft={initialAutoDraft}
            baseUrlMissing={!baseUrl}
          />
        </TabsContent>

        <TabsContent value="outbound" className="space-y-5">
          <OutboundCard audiences={audiences} provider={provider} onDone={() => router.refresh()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------- Status bits ------------------------------ */

function StatusPill({ enabled, live }: { enabled: boolean; live: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        enabled
          ? "border-success/20 bg-success/10 text-success"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <span className="relative flex h-2 w-2">
        {enabled ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        ) : null}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", enabled ? "bg-success" : "bg-muted-foreground/50")} />
      </span>
      {enabled ? "Autopilot active" : "Autopilot paused"}
      {!live ? <span className="opacity-60">· sample data</span> : null}
    </span>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-display text-xl font-semibold tabular-nums">{value}</p>
          {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
        </div>
        <span className={cn("rounded-md p-1.5", accent ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>
          <Icon className="h-4 w-4" />
        </span>
      </CardContent>
    </Card>
  );
}

function NextRunTile({
  enabled,
  lastRunAt,
  cadenceMinutes,
}: {
  enabled: boolean;
  lastRunAt: string | null;
  cadenceMinutes: number;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  let label = "—";
  if (enabled) {
    if (!lastRunAt) label = "soon";
    else {
      const next = new Date(new Date(lastRunAt).getTime() + cadenceMinutes * 60_000);
      label = next.getTime() <= Date.now() ? "due now" : formatDistanceToNow(next, { addSuffix: true });
    }
  }
  return <StatTile icon={Clock} label="Next run" value={label} sub={enabled ? `every ${cadenceMinutes}m` : "paused"} />;
}

/* ------------------------------ Engine panel ------------------------------ */

function EnginePanel({
  enabled,
  onToggle,
  settings,
  onSaved,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  settings: AutopilotSettings;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof AutopilotSettings>(key: K, value: AutopilotSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function toggleChannel(ch: string) {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch) ? f.channels.filter((c) => c !== ch) : [...f.channels, ch],
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const { lastRunAt: _omit, enabled: _omit2, ...payload } = form;
      void _omit;
      void _omit2;
      const res = await fetch("/api/acquisition/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      toast.success("Autopilot settings saved");
      onSaved();
    } catch {
      toast.error("Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  const hourOptions = ["off", ...Array.from({ length: 24 }, (_, i) => String(i))];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" /> Engine
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Master switch */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-start gap-3">
            <span className={cn("mt-0.5 rounded-md p-2", enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
              <Power className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium">Autonomous acquisition</p>
              <p className="text-xs text-muted-foreground">
                When on, the engine sources, enriches, enrolls and drafts on its schedule. Everything lands in Approvals.
              </p>
            </div>
          </div>
          <Toggle checked={enabled} onChange={onToggle} />
        </div>

        {/* Pacing */}
        <div>
          <SectionLabel icon={Gauge}>Pacing & limits</SectionLabel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField label="Run every (min)" value={form.cadenceMinutes} min={5} max={1440} onChange={(v) => set("cadenceMinutes", v)} />
            <NumberField label="Daily lead cap" value={form.dailyLeadCap} min={0} max={1000} onChange={(v) => set("dailyLeadCap", v)} />
            <NumberField label="Target / day" value={form.targetPerDay} min={0} max={1000} onChange={(v) => set("targetPerDay", v)} />
            <NumberField label="Per ICP / run" value={form.perRunBatch} min={1} max={100} onChange={(v) => set("perRunBatch", v)} />
          </div>
        </div>

        {/* Behaviour */}
        <div>
          <SectionLabel icon={ShieldCheck}>Behaviour (human-in-the-loop)</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleRow
              label="Auto-draft inbound replies"
              hint="AI first reply for inbound leads → Approvals"
              checked={form.autoDraftInbound}
              onChange={(v) => set("autoDraftInbound", v)}
            />
            <ToggleRow
              label="Auto-draft outbound first touch"
              hint="Used when auto-enroll is off"
              checked={form.autoDraftOutbound}
              onChange={(v) => set("autoDraftOutbound", v)}
            />
            <ToggleRow
              label="Auto-enroll into cadence"
              hint="New leads join the default sequence"
              checked={form.autoEnroll}
              onChange={(v) => set("autoEnroll", v)}
            />
            <ToggleRow
              label="Enrich new leads"
              hint="Derive website, value & rescore"
              checked={form.enrichLeads}
              onChange={(v) => set("enrichLeads", v)}
            />
            <ToggleRow
              label="Audit lead websites"
              hint="PageSpeed/heuristic check feeds personalised drafts"
              checked={form.auditWebsites}
              onChange={(v) => set("auditWebsites", v)}
            />
            <ToggleRow
              label="Auto-send approved emails"
              hint="Full automation: AI drafts are sent without review"
              checked={form.autoSendEmails}
              onChange={(v) => set("autoSendEmails", v)}
            />
          </div>
          {form.autoSendEmails ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField label="Daily email cap" value={form.dailyEmailCap} min={0} max={500} onChange={(v) => set("dailyEmailCap", v)} />
            </div>
          ) : null}
        </div>

        {/* Quiet hours + channels */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <SectionLabel icon={Clock}>Quiet hours (local)</SectionLabel>
            <div className="flex items-center gap-2">
              <HourSelect
                value={form.quietHoursStart}
                options={hourOptions}
                onChange={(v) => set("quietHoursStart", v)}
              />
              <span className="text-sm text-muted-foreground">→</span>
              <HourSelect
                value={form.quietHoursEnd}
                options={hourOptions}
                onChange={(v) => set("quietHoursEnd", v)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">No fresh outreach is drafted in this window.</p>
          </div>

          <div className="space-y-1.5">
            <SectionLabel icon={Send}>Outreach channels</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {CHANNEL_OPTIONS.map((ch) => {
                const on = form.channels.includes(ch);
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => toggleChannel(ch)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                      on
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {ch.toLowerCase().replace("_", " ")}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionLabel({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {children}
    </p>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="tabular-nums"
      />
    </div>
  );
}

function HourSelect({
  value,
  options,
  onChange,
}: {
  value: number | null;
  options: string[];
  onChange: (v: number | null) => void;
}) {
  return (
    <Select
      value={value == null ? "off" : String(value)}
      onValueChange={(v) => onChange(v === "off" ? null : Number(v))}
    >
      <SelectTrigger className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o === "off" ? "Off" : `${o.padStart(2, "0")}:00`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-success" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

/* ------------------------------- Runs feed -------------------------------- */

const RUN_STATUS_CLASS: Record<string, string> = {
  SUCCESS: "bg-success/10 text-success border-success/20",
  PARTIAL: "bg-warning/10 text-warning border-warning/20",
  SKIPPED: "bg-muted text-muted-foreground border-border",
  ERROR: "bg-destructive/10 text-destructive border-destructive/20",
};

function RunsFeed({ runs }: { runs: RunRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radar className="h-4 w-4" /> Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No runs yet. Hit “Run now”, or wait for the next scheduled tick.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {runs.map((r) => {
              const counts =
                r.status === "SKIPPED"
                  ? r.detail?.reason ?? "skipped"
                  : [
                      r.created ? `+${r.created} leads` : "",
                      r.deduped ? `${r.deduped} dup` : "",
                      r.enriched ? `${r.enriched} enriched` : "",
                      r.drafted ? `${r.drafted} drafted` : "",
                      r.enrolled ? `${r.enrolled} enrolled` : "",
                      r.advanced ? `${r.advanced} advanced` : "",
                      r.hotDetected ? `${r.hotDetected} hot` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "nothing new";
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", RUN_STATUS_CLASS[r.status] ?? RUN_STATUS_CLASS.SKIPPED)}>
                      {r.status.toLowerCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{r.error ? <span className="text-destructive">{r.error}</span> : counts}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.trigger.toLowerCase()} · {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                        {r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Sequences --------------------------------- */

function SequencesPanel({ sequences, onChange }: { sequences: SequenceRow[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function patch(id: string, body: Record<string, unknown>, msg: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/sequences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast.success(msg);
      onChange();
    } catch {
      toast.error("Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function enroll(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/sequences/${id}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eligible: true }),
      });
      if (!res.ok) throw new Error();
      const r: { enrolled: number } = await res.json();
      toast.success(r.enrolled ? `Enrolled ${r.enrolled} eligible lead(s)` : "No eligible leads to enroll");
      onChange();
    } catch {
      toast.error("Enroll failed");
    } finally {
      setBusy(null);
    }
  }

  async function create(isDefault: boolean) {
    if (!name.trim()) {
      toast.error("Give the cadence a name");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), isDefault }),
      });
      if (!res.ok) throw new Error();
      toast.success("Cadence created with the 4-touch default steps");
      setName("");
      onChange();
    } catch {
      toast.error("Could not create cadence");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4" /> Outreach cadences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A cadence is a multi-touch sequence. When a step comes due, the autopilot writes it and queues it in
            Approvals — you approve, then send. Leads auto-enroll into the <span className="font-medium">default</span> cadence.
          </p>

          {sequences.length === 0 ? (
            <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              No cadences yet. Create one below — it’ll seed the proven 4-touch default.
            </p>
          ) : (
            <ul className="space-y-3">
              {sequences.map((s) => (
                <li key={s.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{s.name}</p>
                        {s.isDefault ? (
                          <Badge variant="secondary" className="gap-1">
                            <Star className="h-3 w-3" /> default
                          </Badge>
                        ) : null}
                        <Badge variant={s.active ? "success" : "outline"}>{s.active ? "active" : "paused"}</Badge>
                      </div>
                      {s.description ? <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p> : null}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {s.activeEnrollments} active · {s.enrollments} total enrolled
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Toggle checked={s.active} disabled={busy === s.id} onChange={(v) => patch(s.id, { active: v }, v ? "Cadence resumed" : "Cadence paused")} />
                      {!s.isDefault ? (
                        <Button variant="outline" size="sm" disabled={busy === s.id} onClick={() => patch(s.id, { isDefault: true }, "Set as default cadence")}>
                          Make default
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" disabled={busy === s.id} onClick={() => enroll(s.id)}>
                        {busy === s.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Users className="mr-1.5 h-3.5 w-3.5" />}
                        Enroll eligible
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.steps.map((st) => (
                      <StepPill key={st.id} step={st} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
            <Input
              placeholder="New cadence name (e.g. Manufacturers Q3)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="sm:max-w-xs"
            />
            <div className="flex gap-2">
              <Button variant="outline" disabled={creating} onClick={() => create(false)}>
                {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                Create cadence
              </Button>
              {sequences.every((s) => !s.isDefault) ? (
                <Button disabled={creating} onClick={() => create(true)}>
                  Create as default
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const KIND_LABEL: Partial<Record<ContentKind, string>> = {
  EMAIL: "Email",
  DM: "DM",
  FOLLOW_UP: "Follow-up",
  AD: "Ad",
  POST: "Post",
  OFFER: "Offer",
  SUBJECT_LINE: "Subject",
  COLD_CALL_SCRIPT: "Call",
};

function StepPill({ step }: { step: SequenceStepRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]">
      <span className="font-semibold text-foreground">{step.order}</span>
      <span className="text-muted-foreground">
        D{step.dayOffset === 0 ? "0" : `+${step.dayOffset}`} · {KIND_LABEL[step.kind] ?? step.kind} · {step.channel.toLowerCase()}
      </span>
    </span>
  );
}

/* ---------------------------- Recently captured --------------------------- */

function RecentlyCaptured({ recent }: { recent: RecentLead[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recently captured</CardTitle>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No auto-captured leads yet. Wire up a form/webhook, or let the autopilot source some.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link href={`/leads/${l.id}`} className="text-sm font-medium hover:underline">
                    {l.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.companyName ?? "—"} · {formatDistanceToNow(new Date(l.createdAt), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SourceBadge source={l.source} />
                  <ScoreBadge score={l.score} grade={l.grade} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Shared bits ------------------------------- */

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Copy failed");
        }
      }}
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      {label ?? (copied ? "Copied" : "Copy")}
    </Button>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> {title}
        </Label>
        <CopyButton text={code} />
      </div>
      <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed scroll-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function InboundCard({
  token,
  captureUrl,
  origin,
  initialAutoDraft,
  baseUrlMissing,
}: {
  token: string;
  captureUrl: string;
  origin: string;
  initialAutoDraft: boolean;
  baseUrlMissing: boolean;
}) {
  const [autoDraft, setAutoDraft] = useState(initialAutoDraft);
  const [saving, setSaving] = useState(false);

  async function toggleAutoDraft(next: boolean) {
    setAutoDraft(next);
    setSaving(true);
    try {
      const res = await fetch("/api/acquisition/inbound", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoDraft: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? "AI will draft a first reply for new leads" : "Auto-draft turned off");
    } catch {
      setAutoDraft(!next);
      toast.error("Could not update setting");
    } finally {
      setSaving(false);
    }
  }

  const curl = `curl -X POST ${captureUrl} \\
  -H "Content-Type: application/json" \\
  -H "X-Ingest-Token: ${token}" \\
  -d '{"name":"Jan Kowalski","email":"jan@firma.pl","message":"Proszę o kontakt"}'`;

  const html = `<form id="lead">
  <input name="name" placeholder="Imię i nazwisko" />
  <input name="email" type="email" placeholder="E-mail" />
  <textarea name="message" placeholder="Wiadomość"></textarea>
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off" />
  <button type="submit">Wyślij</button>
</form>
<script>
  lead.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(lead));
    await fetch("${captureUrl}", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ingest-Token": "${token}" },
      body: JSON.stringify(f),
    });
    lead.reset();
  };
</script>`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" /> Inbound — leads come to you
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Point any website form, landing page or lead-ad at the endpoint below. Leads are
          deduplicated, scored and assigned automatically.
        </p>

        {baseUrlMissing ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            Using your current browser origin for the URLs below. Set <code>NEXTAUTH_URL</code> to
            your production domain so they&apos;re paste-ready everywhere.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label>Capture endpoint</Label>
          <div className="flex items-center gap-2">
            <Input readOnly value={captureUrl} className="font-mono text-xs" />
            <CopyButton text={captureUrl} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Capture token (header <code>X-Ingest-Token</code>)</Label>
          <div className="flex items-center gap-2">
            <Input readOnly value={token} className="font-mono text-xs" />
            <CopyButton text={token} />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-md border border-border p-3">
          <input
            type="checkbox"
            checked={autoDraft}
            disabled={saving}
            onChange={(e) => toggleAutoDraft(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <span className="text-sm">
            <span className="font-medium">Auto-draft a first reply with AI</span>
            <span className="block text-xs text-muted-foreground">
              Each new lead gets an AI-drafted first-touch reply queued in Approvals (never sent
              automatically).
            </span>
          </span>
        </label>

        <div className="grid gap-4 lg:grid-cols-2">
          <Snippet title="Drop-in HTML form" code={html} />
          <Snippet title="Server / cURL" code={curl} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Webhook URLs</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Paste into Meta Lead Ads, Google Lead Forms, Typeform, Tally, Calendly, Zapier/Make.
          </p>
          <div className="space-y-2">
            {WEBHOOK_PROVIDERS.map((p) => {
              const url = `${origin}/api/webhooks/${p}?token=${token}`;
              return (
                <div key={p} className="flex items-center gap-2">
                  <Badge variant="outline" className="w-24 justify-center capitalize">
                    {p}
                  </Badge>
                  <Input readOnly value={url} className="font-mono text-[11px]" />
                  <CopyButton text={url} label="" />
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OutboundCard({
  audiences,
  provider,
  onDone,
}: {
  audiences: Audience[];
  provider: { name: string; live: boolean };
  onDone: () => void;
}) {
  const [audienceId, setAudienceId] = useState(AUTO);
  const [limit, setLimit] = useState("10");
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const res = await fetch("/api/acquisition/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audienceId: audienceId === AUTO ? undefined : audienceId,
          limit: Number(limit) || 10,
        }),
      });
      if (!res.ok) throw new Error();
      const data: { created: number; deduped: number; found: number; live: boolean } = await res.json();
      if (data.created === 0 && data.found === 0) {
        toast.info("No prospects returned for that ICP.");
      } else {
        toast.success(
          `Added ${data.created} new lead${data.created === 1 ? "" : "s"}${data.deduped ? ` · ${data.deduped} duplicate(s) skipped` : ""}`,
        );
        onDone();
      }
    } catch {
      toast.error("Discovery failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radar className="h-4 w-4" /> Outbound — find prospects from your ICP
          <Badge variant={provider.live ? "success" : "warning"} className="ml-1">
            {provider.live ? provider.name : "sample data"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Pulls fresh prospects matching an ICP, then dedupes, scores and assigns them as new
          leads. {provider.live ? null : "Currently using sample prospects — "}
          {provider.live ? (
            <>Live source connected.</>
          ) : (
            <>
              set <code>APOLLO_API_KEY</code> or <code>HUNTER_API_KEY</code> for real sourcing.
            </>
          )}
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label>ICP / Audience</Label>
            <Select value={audienceId} onValueChange={setAudienceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Primary ICP (auto)</SelectItem>
                {audiences.map((au) => (
                  <SelectItem key={au.id} value={au.id}>
                    {au.name}
                    {au.industry ? ` · ${au.industry}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-limit">How many</Label>
            <Input
              id="d-limit"
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-24"
            />
          </div>
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
            Run discovery
          </Button>
        </div>

        {audiences.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Tip: create an Audience to sharpen targeting — discovery will still run with sensible
            defaults.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
