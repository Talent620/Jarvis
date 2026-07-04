import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Users, Flame, Wallet, TrendingUp, Activity } from "lucide-react";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  computeSnapshot,
  funnelDistribution,
  sourceDistribution,
} from "@/lib/metrics";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FunnelBar } from "@/components/charts/funnel-bar";
import { SourceBar } from "@/components/charts/source-bar";
import { GradeDonut } from "@/components/charts/grade-donut";
import { TrendLine } from "@/components/charts/trend-line";
import { CHART } from "@/components/charts/chart-theme";

export const dynamic = "force-dynamic";

const SERIES_META: Record<string, { title: string; color: string; currency?: boolean }> = {
  "pipeline.value": { title: "Pipeline value", color: CHART.primary, currency: true },
  "revenue.won": { title: "Revenue won", color: CHART.sand, currency: true },
  "leads.new": { title: "New leads", color: CHART.primary },
  "reply.rate": { title: "Reply rate (%)", color: CHART.sand },
};

export default async function AnalyticsPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const [snapshot, funnel, sources, gradeGroups, snapshots, decisions] =
    await Promise.all([
      computeSnapshot(companyId),
      funnelDistribution(companyId),
      sourceDistribution(companyId),
      prisma.lead.groupBy({
        by: ["scoreGrade"],
        where: { companyId, deletedAt: null },
        _count: { _all: true },
      }),
      prisma.metricSnapshot.findMany({
        where: { companyId },
        orderBy: { date: "asc" },
        take: 400,
      }),
      prisma.aiDecisionLog.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

  const gradeData = gradeGroups.map((g) => ({
    grade: g.scoreGrade,
    count: g._count._all,
  }));

  // Group metric snapshots by key into series for trend charts.
  const seriesMap = new Map<string, { date: string; value: number }[]>();
  for (const s of snapshots) {
    if (!seriesMap.has(s.key)) seriesMap.set(s.key, []);
    seriesMap.get(s.key)!.push({ date: s.date.toISOString(), value: s.value });
  }
  const trendKeys = Object.keys(SERIES_META).filter((k) => seriesMap.has(k));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="How your pipeline, sources and revenue are trending."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total leads" value={snapshot.totalLeads} icon={Users} />
        <KpiCard
          label="Hot leads"
          value={snapshot.hotLeads}
          icon={Flame}
          accent={snapshot.hotLeads > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Pipeline value"
          value={formatCurrency(snapshot.pipelineValue, snapshot.currency)}
          icon={Wallet}
        />
        <KpiCard
          label="Reply rate"
          value={`${snapshot.replyRate}%`}
          icon={TrendingUp}
          accent="success"
        />
      </div>

      {trendKeys.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {trendKeys.map((key) => (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="text-base">{SERIES_META[key].title}</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendLine
                  points={seriesMap.get(key)!}
                  color={SERIES_META[key].color}
                  height={220}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Funnel distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {funnel.some((f) => f.count > 0) ? (
              <FunnelBar data={funnel} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No leads in the funnel yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead quality</CardTitle>
          </CardHeader>
          <CardContent>
            {gradeData.some((g) => g.count > 0) ? (
              <GradeDonut data={gradeData} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead sources</CardTitle>
          </CardHeader>
          <CardContent>
            {sources.length > 0 ? (
              <SourceBar data={sources} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Recent AI activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {decisions.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No AI activity yet"
                  description="Generated drafts and AI decisions will be logged here for full auditability."
                />
              </div>
            ) : (
              <ul className="divide-y">
                {decisions.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {d.actionType
                          .toLowerCase()
                          .split("_")
                          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                          .join(" ")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.provider}
                        {d.model ? ` · ${d.model}` : ""} ·{" "}
                        {formatDistanceToNow(d.createdAt, { addSuffix: true })}
                      </p>
                    </div>
                    <span
                      className={
                        d.status === "SUCCESS"
                          ? "text-xs font-medium text-success"
                          : d.status === "FALLBACK"
                            ? "text-xs font-medium text-warning"
                            : "text-xs font-medium text-destructive"
                      }
                    >
                      {d.status.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
