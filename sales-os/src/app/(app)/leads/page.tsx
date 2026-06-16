import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { LeadsClient } from "@/components/leads/leads-client";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");

  const stages = await prisma.funnelStage.findMany({
    where: { companyId: a.ctx.companyId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, color: true },
  });

  return <LeadsClient stages={stages} />;
}
