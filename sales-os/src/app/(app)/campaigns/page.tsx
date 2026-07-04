import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { CampaignsClient } from "@/components/campaigns/campaigns-client";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const [audiences, offers] = await Promise.all([
    prisma.audience.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.offer.findMany({
      where: { companyId, active: true },
      orderBy: { tier: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return <CampaignsClient audiences={audiences} offers={offers} />;
}
