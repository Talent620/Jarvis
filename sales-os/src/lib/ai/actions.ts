import { Priority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HOT_LEAD_THRESHOLD } from "@/lib/constants";
import type { MockCopilotSnapshot } from "./mock";

/**
 * A concrete, executable action the Copilot can suggest. Either navigates the
 * user somewhere useful, or performs a real mutation (create a follow-up task).
 * Kept deterministic and grounded in live data so it works in mock mode too.
 */
export type CopilotAction =
  | { kind: "navigate"; label: string; href: string }
  | {
      kind: "createTask";
      label: string;
      title: string;
      leadId?: string;
      priority?: Priority;
      dueInDays?: number;
    };

/**
 * Derive up to four high-leverage next actions from the company's real state:
 * overdue tasks, pending approvals, and the hottest lead that needs a touch.
 */
export async function copilotActions(
  companyId: string,
  snapshot: MockCopilotSnapshot,
): Promise<CopilotAction[]> {
  const actions: CopilotAction[] = [];

  if (snapshot.overdueTasks > 0) {
    actions.push({
      kind: "navigate",
      label: `Review ${snapshot.overdueTasks} overdue task${snapshot.overdueTasks === 1 ? "" : "s"}`,
      href: "/tasks",
    });
  }

  if (snapshot.pendingApprovals > 0) {
    actions.push({
      kind: "navigate",
      label: `Approve ${snapshot.pendingApprovals} AI draft${snapshot.pendingApprovals === 1 ? "" : "s"}`,
      href: "/approvals",
    });
  }

  const topHot = await prisma.lead.findFirst({
    where: {
      companyId,
      deletedAt: null,
      outcome: "OPEN",
      score: { gte: HOT_LEAD_THRESHOLD },
    },
    orderBy: { score: "desc" },
    select: { id: true, name: true, nextActionAt: true },
  });

  if (topHot) {
    actions.push({
      kind: "navigate",
      label: `Draft a follow-up for ${topHot.name}`,
      href: `/generator?leadId=${topHot.id}&kind=FOLLOW_UP`,
    });
    if (!topHot.nextActionAt) {
      actions.push({
        kind: "createTask",
        label: `Schedule a follow-up task for ${topHot.name}`,
        title: `Follow up with ${topHot.name}`,
        leadId: topHot.id,
        priority: Priority.HIGH,
        dueInDays: 1,
      });
    }
  }

  if (actions.length === 0) {
    if (snapshot.totalLeads === 0) {
      actions.push({ kind: "navigate", label: "Add your first lead", href: "/leads" });
    } else {
      actions.push({ kind: "navigate", label: "Open the pipeline", href: "/pipeline" });
    }
  }

  return actions.slice(0, 4);
}
