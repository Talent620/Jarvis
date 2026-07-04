import Link from "next/link";
import { formatDistanceToNow, isPast } from "date-fns";
import {
  Users,
  Flame,
  PhoneCall,
  ListChecks,
  Wallet,
  ArrowRight,
  BadgeCheck,
  Activity,
  Sparkles,
  CircleAlert,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/api";
import { computeSnapshot, funnelDistribution, sourceDistribution } from "@/lib/metrics";
import { nextBestAction } from "@/lib/next-best-action";
import { formatCurrency } from "@/lib/utils";
import { HOT_LEAD_THRESHOLD } from "@/lib/constants";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi-card";
import { EmptyState } from "@/components/empty-state";
import { ScoreBadge } from "@/components/score-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { FunnelBar } from "@/components/charts/funnel-bar";
import { SourceBar } from "@/components/charts/source-bar";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const [snapshot, funnel, sources, hotLeads, tasks, approvals, activity, callQueue] = await Promise.all([
    computeSnapshot(companyId),
    funnelDistribution(companyId),
    sourceDistribution(companyId),
    prisma.lead.findMany({
      where: { companyId, deletedAt: null, outcome: "OPEN", score: { gte: HOT_LEAD_THRESHOLD } },
      include: { stage: true },
      orderBy: { score: "desc" },
      take: 5,
    }),
    prisma.task.findMany({
      where: { companyId, deletedAt: null, status: { in: ["TODO", "IN_PROGRESS"] } },
      include: { lead: { select: { id: true, name: true } } },
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
      take: 6,
    }),
    prisma.approvalRequest.findMany({
      where: { companyId, status: "PENDING" },
      include: { lead: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    prisma.leadActivity.findMany({
      where: { companyId },
      include: { lead: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 7,
    }),
    prisma.lead.findMany({
      where: {
        companyId,
        deletedAt: null,
        outcome: "OPEN",
        phone: { not: null },
        callStatus: { in: ["NOT_CALLED", "NO_ANSWER", "VOICEMAIL", "CALLBACK"] },
      },
      orderBy: [{ callStatus: "asc" }, { score: "desc" }],
      take: 5,
      select: {
        id: true, name: true, phone: true, score: true, scoreGrade: true,
        callStatus: true, hasWebsite: true, nextCallAt: true,
      },
    }),
  ]);

  const fmt = (n: number) => formatCurrency(n, snapshot.currency);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Your acquisition system at a glance — what&apos;s hot, what&apos;s due, what needs a decision.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/copilot">
              <Sparkles className="h-4 w-4" />
              Ask Copilot
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/leads">
              View leads
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total leads" value={snapshot.totalLeads} icon={Users} hint={`${snapshot.hotLeads} hot right now`} />
        <KpiCard
          label="Hot leads"
          value={snapshot.hotLeads}
          icon={Flame}
          accent={snapshot.hotLeads > 0 ? "success" : "default"}
          hint="Score ≥ 75 · reach out first"
        />
        <KpiCard
          label="Open tasks"
          value={snapshot.openTasks}
          icon={ListChecks}
          accent={snapshot.overdueTasks > 0 ? "warning" : "default"}
          hint={snapshot.overdueTasks > 0 ? `${snapshot.overdueTasks} overdue` : "All on time"}
        />
        <KpiCard label="Pipeline value" value={fmt(snapshot.pipelineValue)} icon={Wallet} hint={`Won: ${fmt(snapshot.wonValue)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column: funnel + sources */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Pipeline funnel</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/pipeline">
                  Open pipeline <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {funnel.some((f) => f.count > 0) ? (
                <FunnelBar data={funnel} />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No leads in the pipeline yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Leads by source</CardTitle>
            </CardHeader>
            <CardContent>
              {sources.length > 0 ? (
                <SourceBar data={sources} />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No sources to show.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: call list + hot leads + tasks + approvals */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <PhoneCall className="h-4 w-4 text-primary" /> Call list
              </CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/calls">Queue</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {callQueue.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No one waiting for a call.
                </p>
              ) : (
                callQueue.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                  >
                    <Link href={`/leads/${l.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium hover:underline">{l.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {l.hasWebsite === false ? "No website · " : ""}
                        {l.callStatus === "CALLBACK" && l.nextCallAt
                          ? `callback ${formatDistanceToNow(new Date(l.nextCallAt), { addSuffix: true })}`
                          : l.callStatus === "NOT_CALLED"
                            ? "never called"
                            : "retry"}
                      </p>
                    </Link>
                    <Button asChild variant="outline" size="sm">
                      <a href={`tel:${l.phone!.replace(/\s+/g, "")}`}>
                        <PhoneCall className="h-3.5 w-3.5" /> Call
                      </a>
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-success" /> Hot leads
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {hotLeads.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No hot leads yet.</p>
              ) : (
                hotLeads.map((lead) => {
                  const nba = nextBestAction(lead);
                  return (
                    <Link
                      key={lead.id}
                      href={`/leads/${lead.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3 transition-colors hover:bg-secondary/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{lead.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{nba.label}</p>
                      </div>
                      <ScoreBadge score={lead.score} grade={lead.scoreGrade} />
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-4 w-4" /> Today &amp; overdue
              </CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/tasks">All</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasks.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nothing on your list.</p>
              ) : (
                tasks.map((t) => {
                  const overdue = t.dueDate ? isPast(new Date(t.dueDate)) : false;
                  return (
                    <div key={t.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t.lead ? t.lead.name : "General"}
                          {t.dueDate
                            ? ` · ${overdue ? "overdue " : "due "}${formatDistanceToNow(new Date(t.dueDate), { addSuffix: true })}`
                            : ""}
                        </p>
                      </div>
                      {overdue ? <CircleAlert className="h-4 w-4 shrink-0 text-warning" /> : <PriorityBadge priority={t.priority} />}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <BadgeCheck className="h-4 w-4" /> Approvals
              </CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/approvals">Review</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {approvals.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No AI drafts waiting.</p>
              ) : (
                <ul className="space-y-2">
                  {approvals.map((ap) => (
                    <li key={ap.id} className="rounded-md border border-border p-3">
                      <p className="text-sm font-medium">{ap.title}</p>
                      {ap.summary ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{ap.summary}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Activity feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" /> Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" description="As you work leads, everything shows up here." />
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{ev.title}</span>
                    {ev.lead ? (
                      <Link href={`/leads/${ev.lead.id}`} className="ml-2 text-muted-foreground hover:underline">
                        {ev.lead.name}
                      </Link>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
