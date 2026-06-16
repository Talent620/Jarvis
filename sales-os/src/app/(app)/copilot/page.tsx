import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { computeSnapshot } from "@/lib/metrics";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { CopilotClient } from "@/components/copilot/copilot-client";

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const [company, snapshot] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    }),
    computeSnapshot(companyId),
  ]);

  const greeting =
    `Hi! I'm your sales copilot for ${company?.name ?? "your workspace"}. ` +
    `Right now you have ${snapshot.totalLeads} leads (${snapshot.hotLeads} hot), ` +
    `${snapshot.openTasks} open tasks${
      snapshot.overdueTasks ? ` — ${snapshot.overdueTasks} overdue` : ""
    }, and ${formatCurrency(snapshot.pipelineValue, snapshot.currency)} in the pipeline. ` +
    `Ask me what to prioritise, and I'll reason over your live data.`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Copilot"
        description="Your always-on strategist — ask anything about your pipeline."
      />
      <CopilotClient greeting={greeting} />
    </div>
  );
}
