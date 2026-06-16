import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ContentKind } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { GeneratorClient } from "@/components/generator/generator-client";

export const dynamic = "force-dynamic";

const VALID_KINDS = new Set<string>(Object.values(ContentKind));

export default async function GeneratorPage({
  searchParams,
}: {
  searchParams: { leadId?: string; kind?: string };
}) {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const [leads, offers] = await Promise.all([
    prisma.lead.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { score: "desc" },
      take: 100,
      select: { id: true, name: true, companyName: true },
    }),
    prisma.offer.findMany({
      where: { companyId, active: true },
      orderBy: { tier: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const defaultKind =
    searchParams.kind && VALID_KINDS.has(searchParams.kind)
      ? (searchParams.kind as ContentKind)
      : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Generator"
        description="Draft outreach, ads and follow-ups grounded in your lead and offer context."
      />
      <GeneratorClient
        leads={leads}
        offers={offers}
        defaultLeadId={searchParams.leadId}
        defaultKind={defaultKind}
      />
    </div>
  );
}
