import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { SettingsClient } from "@/components/settings/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");

  const company = await prisma.company.findUnique({
    where: { id: a.ctx.companyId },
    include: {
      integrations: { orderBy: { type: "asc" } },
      _count: { select: { users: true, leads: true } },
    },
  });

  if (!company) redirect("/login");

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your workspace and AI behaviour." />
      <SettingsClient
        company={{
          name: company.name,
          industry: company.industry,
          website: company.website,
          timezone: company.timezone,
          currency: company.currency,
          aiContext: company.aiContext,
          integrations: company.integrations.map((i) => ({
            id: i.id,
            type: i.type,
            provider: i.provider,
            status: i.status,
          })),
          _count: company._count,
        }}
      />
    </div>
  );
}
