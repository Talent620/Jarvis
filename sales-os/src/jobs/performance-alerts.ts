import { prisma } from "@/lib/prisma";
import { computeSnapshot } from "@/lib/metrics";
import type { JobContext } from "./runner";

const REPLY_RATE_FLOOR = 15;

/**
 * Watch headline performance and raise an alert + a funnel suggestion when the
 * reply rate drops below a healthy floor. Deduped to one open alert per day.
 */
export async function performanceAlerts({ companyId }: JobContext) {
  const snapshot = await computeSnapshot(companyId);
  if (snapshot.replyRate >= REPLY_RATE_FLOOR) return { raised: false };

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const recent = await prisma.notification.findFirst({
    where: { companyId, type: "PERFORMANCE_ALERT", createdAt: { gte: since } },
    select: { id: true },
  });
  if (recent) return { raised: false };

  await prisma.notification.createMany({
    data: [
      {
        companyId,
        type: "PERFORMANCE_ALERT" as const,
        title: "Reply rate is below target",
        body: `Reply rate is ${snapshot.replyRate}% (target ≥ ${REPLY_RATE_FLOOR}%). Messaging or targeting needs attention.`,
        link: "/analytics",
      },
      {
        companyId,
        type: "FUNNEL_SUGGESTION" as const,
        title: "Funnel suggestion",
        body: "Tighten your opening line and personalise the hook per segment — that usually lifts replies fastest.",
        link: "/generator",
      },
    ],
  });

  return { raised: true };
}
