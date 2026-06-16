"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  Phone,
  PhoneCall,
  Loader2,
  CalendarClock,
  ThumbsUp,
  StickyNote,
  GlobeLock,
  Wrench,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { CallStatus, ScoreGrade } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { EmptyState } from "@/components/empty-state";
import { ScoreBadge } from "@/components/score-badge";
import { CALL_STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface CallLead {
  id: string;
  name: string;
  companyName: string | null;
  phone: string;
  score: number;
  scoreGrade: ScoreGrade;
  callStatus: CallStatus;
  callAttempts: number;
  lastCallAt: string | null;
  nextCallAt: string | null;
  hasWebsite: boolean | null;
  auditScore: number | null;
  industry: string | null;
  region: string | null;
  tags: string[];
  lastNote: string | null;
  audit: { overall: number; summary: string | null; issues: string[] } | null;
}

const LOG_STATUSES: CallStatus[] = [
  "NO_ANSWER",
  "VOICEMAIL",
  "CALLBACK",
  "INTERESTED",
  "NOT_INTERESTED",
  "MEETING_BOOKED",
  "WRONG_NUMBER",
];

type Filter = "queue" | "callbacks" | "interested" | "all";

export function CallsClient({
  leads,
  kpis,
}: {
  leads: CallLead[];
  kpis: { callsToday: number; meetingsBooked: number; interested: number };
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("queue");
  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<CallStatus | null>(null);
  const [note, setNote] = useState("");
  const [nextCallAt, setNextCallAt] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    switch (filter) {
      case "queue":
        return leads.filter((l) => l.callStatus === "NOT_CALLED" || l.callStatus === "NO_ANSWER" || l.callStatus === "VOICEMAIL");
      case "callbacks":
        return leads.filter((l) => l.callStatus === "CALLBACK");
      case "interested":
        return leads.filter((l) => l.callStatus === "INTERESTED" || l.callStatus === "MEETING_BOOKED");
      default:
        return leads;
    }
  }, [leads, filter]);

  function openLog(leadId: string) {
    setOpenId(openId === leadId ? null : leadId);
    setStatus(null);
    setNote("");
    setNextCallAt("");
  }

  async function saveLog(leadId: string) {
    if (!status) {
      toast.error("Pick a call outcome");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          note: note.trim() || undefined,
          nextCallAt: nextCallAt ? new Date(nextCallAt).toISOString() : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Call logged");
      setOpenId(null);
      router.refresh();
    } catch {
      toast.error("Could not log the call");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calls"
        description="Your calling queue — best leads first, with audit facts to mention and one-tap outcome logging."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Calls made today" value={kpis.callsToday} icon={PhoneCall} />
        <KpiCard label="Interested" value={kpis.interested} icon={ThumbsUp} accent="warning" />
        <KpiCard label="Meetings booked" value={kpis.meetingsBooked} icon={CalendarClock} accent="success" />
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="queue">To call</TabsTrigger>
          <TabsTrigger value="callbacks">Callbacks</TabsTrigger>
          <TabsTrigger value="interested">Warm</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Phone}
          title="Nothing in this queue"
          description="Import leads with phone numbers from the Lead Finder — they'll show up here ready to call."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((l) => {
            const meta = CALL_STATUS_META[l.callStatus];
            const open = openId === l.id;
            return (
              <Card key={l.id} className={cn(open && "ring-1 ring-primary/40")}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/leads/${l.id}`} className="font-medium text-foreground hover:underline">
                          {l.name}
                        </Link>
                        <ScoreBadge score={l.score} grade={l.scoreGrade} />
                        <Badge variant="outline" className={meta.className}>
                          {meta.label}
                        </Badge>
                        {l.hasWebsite === false ? (
                          <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                            <GlobeLock className="mr-1 h-3 w-3" /> No website
                          </Badge>
                        ) : null}
                        {l.auditScore != null && l.auditScore < 50 ? (
                          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">
                            <Wrench className="mr-1 h-3 w-3" /> Site {l.auditScore}/100
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[l.companyName, l.industry, l.region].filter(Boolean).join(" · ")}
                        {l.callAttempts > 0 ? ` · ${l.callAttempts} attempt${l.callAttempts === 1 ? "" : "s"}` : ""}
                        {l.lastCallAt
                          ? ` · last call ${formatDistanceToNow(new Date(l.lastCallAt), { addSuffix: true })}`
                          : ""}
                      </p>
                      {l.lastNote ? (
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="line-clamp-2">{l.lastNote}</span>
                        </p>
                      ) : null}
                      {l.audit?.issues.length ? (
                        <p className="text-xs text-warning">
                          Talking points: {l.audit.issues.slice(0, 2).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a href={`tel:${l.phone.replace(/\s+/g, "")}`}>
                          <Phone className="h-4 w-4" /> {l.phone}
                        </a>
                      </Button>
                      <Button variant={open ? "secondary" : "default"} size="sm" onClick={() => openLog(l.id)}>
                        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        Log call
                      </Button>
                    </div>
                  </div>

                  {open ? (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                      <div className="flex flex-wrap gap-2">
                        {LOG_STATUSES.map((s) => (
                          <Button
                            key={s}
                            type="button"
                            size="sm"
                            variant={status === s ? "default" : "outline"}
                            onClick={() => setStatus(s)}
                          >
                            {CALL_STATUS_META[s].label}
                          </Button>
                        ))}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                        <div className="space-y-1.5">
                          <Label htmlFor={`note-${l.id}`}>Note — what did you learn?</Label>
                          <Textarea
                            id={`note-${l.id}`}
                            placeholder="e.g. Owner interested, asked to send the audit by email; decision next week…"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={3}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`next-${l.id}`}>Next call (optional)</Label>
                          <Input
                            id={`next-${l.id}`}
                            type="datetime-local"
                            value={nextCallAt}
                            onChange={(e) => setNextCallAt(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={() => saveLog(l.id)} disabled={saving}>
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Save call
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
