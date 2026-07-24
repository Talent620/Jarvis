import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Mail,
  Phone,
  Globe,
  Building2,
  MapPin,
  Sparkles,
  StickyNote,
  Activity as ActivityIcon,
  Target,
} from "lucide-react";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { nextBestAction } from "@/lib/next-best-action";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScoreBadge } from "@/components/score-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { OutcomeBadge, SourceBadge, TaskStatusBadge } from "@/components/status-badges";
import { LeadActions } from "@/components/leads/lead-actions";
import { AuditCard } from "@/components/leads/audit-card";
import { CallPanel } from "@/components/leads/call-panel";
import { PlaybookCard } from "@/components/leads/playbook-card";
import { buildPlaybook } from "@/lib/playbook";

export const dynamic = "force-dynamic";

const URGENCY_CLASS: Record<string, string> = {
  high: "bg-destructive/10 text-destructive border-destructive/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  low: "bg-secondary text-secondary-foreground border-border",
};

export default async function LeadDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await getAuth();
  if ("res" in a) redirect("/login");

  const [lead, stages, emailsSent] = await Promise.all([
    prisma.lead.findFirst({
      where: { id: params.id, companyId: a.ctx.companyId, deletedAt: null },
      include: {
        stage: true,
        owner: { select: { name: true, email: true } },
        notes: { where: { deletedAt: null }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], include: { author: { select: { name: true } } } },
        activities: { orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } },
        tasks: { where: { deletedAt: null }, orderBy: [{ status: "asc" }, { dueDate: "asc" }] },
        scores: { orderBy: { createdAt: "desc" }, take: 1 },
        audits: { orderBy: { createdAt: "desc" }, take: 1 },
        callLogs: {
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { user: { select: { name: true } } },
        },
      },
    }),
    prisma.funnelStage.findMany({
      where: { companyId: a.ctx.companyId },
      orderBy: { order: "asc" },
      select: { id: true, name: true, color: true },
    }),
    prisma.leadActivity.count({
      where: { leadId: params.id, companyId: a.ctx.companyId, type: "EMAIL" },
    }),
  ]);

  if (!lead) notFound();

  const playbook = buildPlaybook({
    lead,
    stageName: lead.stage?.name ?? null,
    audit: lead.audits[0] ?? null,
    emailsSent,
    lastCallNote: lead.callLogs[0]?.note ?? null,
  });

  const nba = nextBestAction(lead);
  const breakdown = (lead.scores[0]?.breakdown ?? {}) as Record<string, number>;
  const factors = Object.entries(breakdown)
    .filter(([, v]) => v > 0)
    .sort((x, y) => y[1] - x[1]);
  const maxFactor = factors.length ? Math.max(...factors.map(([, v]) => v)) : 1;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
        <Link href="/leads">
          <ArrowLeft className="h-4 w-4" /> Back to leads
        </Link>
      </Button>

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{lead.name}</h1>
            <ScoreBadge score={lead.score} grade={lead.scoreGrade} />
            <OutcomeBadge outcome={lead.outcome} />
          </div>
          <p className="text-sm text-muted-foreground">
            {lead.position ? `${lead.position} · ` : ""}
            {lead.companyName ?? "Independent"}
            {lead.industry ? ` · ${lead.industry}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <SourceBadge source={lead.source} />
            <PriorityBadge priority={lead.priority} />
            {lead.tags.map((t) => (
              <Badge key={t} variant="secondary">{t}</Badge>
            ))}
          </div>
        </div>

        <LeadActions
          leadId={lead.id}
          stages={stages}
          currentStageId={lead.stageId}
          draftKind={nba.draftKind}
          lead={{
            name: lead.name,
            companyName: lead.companyName,
            email: lead.email,
            phone: lead.phone,
            position: lead.position,
            industry: lead.industry,
            region: lead.region,
            website: lead.website,
            source: lead.source,
            priority: lead.priority,
            outcome: lead.outcome,
            estimatedValue: lead.estimatedValue,
            budget: lead.budget,
            nextActionNote: lead.nextActionNote,
          }}
        />
      </div>

      <PlaybookCard playbook={playbook} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: details + score */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Detail icon={Mail} label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
              <Detail icon={Phone} label="Phone" value={lead.phone} />
              <Detail icon={Building2} label="Company" value={lead.companyName} />
              <Detail icon={Globe} label="Website" value={lead.website} href={lead.website ?? undefined} />
              <Detail icon={MapPin} label="Region" value={lead.region} />
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Deal value</span>
                <span className="font-medium tabular-nums">{lead.estimatedValue ? formatCurrency(lead.estimatedValue) : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Declared budget</span>
                <span className="font-medium tabular-nums">{lead.budget ? formatCurrency(lead.budget) : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Stage</span>
                <span className="font-medium">{lead.stage?.name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Owner</span>
                <span className="font-medium">{lead.owner?.name ?? "Unassigned"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last contacted</span>
                <span className="font-medium">
                  {lead.lastContactedAt ? formatDistanceToNow(new Date(lead.lastContactedAt), { addSuffix: true }) : "Never"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Why this score</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{lead.scores[0]?.reason ?? "Not scored yet."}</p>
              {factors.map(([name, value]) => (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="font-medium tabular-nums">+{value}</span>
                  </div>
                  <Progress value={(value / maxFactor) * 100} className="h-1.5" />
                </div>
              ))}
            </CardContent>
          </Card>

          <AuditCard
            leadId={lead.id}
            website={lead.website}
            hasWebsite={lead.hasWebsite}
            audit={
              lead.audits[0]
                ? {
                    overall: lead.audits[0].overall,
                    https: lead.audits[0].https,
                    mobileFriendly: lead.audits[0].mobileFriendly,
                    performance: lead.audits[0].performance,
                    seo: lead.audits[0].seo,
                    loadTimeMs: lead.audits[0].loadTimeMs,
                    issues: lead.audits[0].issues,
                    opportunities: lead.audits[0].opportunities,
                    summary: lead.audits[0].summary,
                    provider: lead.audits[0].provider,
                    createdAt: lead.audits[0].createdAt.toISOString(),
                  }
                : null
            }
          />
        </div>

        {/* Middle/right: NBA + timeline + notes + tasks */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="border-primary/20 bg-primary/[0.03]">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Next best action
              </CardTitle>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${URGENCY_CLASS[nba.urgency]}`}>
                {nba.urgency} priority
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="font-medium">{nba.label}</p>
              <p className="text-sm text-muted-foreground">{nba.rationale}</p>
              {nba.draftKind ? (
                <Button asChild size="sm">
                  <Link href={`/generator?leadId=${lead.id}&kind=${nba.draftKind}`}>
                    <Sparkles className="h-4 w-4" /> Draft with AI
                  </Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <CallPanel
            leadId={lead.id}
            phone={lead.phone}
            callStatus={lead.callStatus}
            calls={lead.callLogs.map((c) => ({
              id: c.id,
              status: c.status,
              note: c.note,
              createdAt: c.createdAt.toISOString(),
              userName: c.user?.name ?? null,
            }))}
          />

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <StickyNote className="h-4 w-4" /> Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {lead.notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                ) : (
                  lead.notes.map((n) => (
                    <div key={n.id} className="rounded-md border border-border p-3">
                      <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {n.author?.name ?? "Someone"} · {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        {n.pinned ? " · pinned" : ""}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tasks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {lead.tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tasks linked to this lead.</p>
                ) : (
                  lead.tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        {t.dueDate ? (
                          <p className="text-xs text-muted-foreground">Due {format(new Date(t.dueDate), "d MMM")}</p>
                        ) : null}
                      </div>
                      <TaskStatusBadge status={t.status} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ActivityIcon className="h-4 w-4" /> Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lead.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              ) : (
                <ol className="relative space-y-4 border-l border-border pl-5">
                  {lead.activities.map((ev) => (
                    <li key={ev.id} className="relative">
                      <span className="absolute -left-[1.42rem] top-1.5 h-2 w-2 rounded-full bg-primary" />
                      <p className="text-sm font-medium">{ev.title}</p>
                      {ev.body ? <p className="mt-0.5 text-sm text-muted-foreground">{ev.body}</p> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ev.user?.name ? `${ev.user.name} · ` : ""}
                        {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Mail;
  label: string;
  value?: string | null;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      {value ? (
        href ? (
          <a href={href} className="truncate font-medium text-primary hover:underline" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
            {value}
          </a>
        ) : (
          <span className="truncate font-medium">{value}</span>
        )
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}
