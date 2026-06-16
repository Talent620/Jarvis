import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ensureAcquisitionSettings } from "@/lib/acquisition/settings";
import { getBusinessProviders } from "@/lib/prospecting";
import { ProspectingClient } from "@/components/prospecting/prospecting-client";

export const dynamic = "force-dynamic";

export default async function ProspectingPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  const { companyId } = a.ctx;

  const settings = await ensureAcquisitionSettings(companyId);
  const providers = getBusinessProviders();

  const [importedTotal, noWebsiteTotal, modernizationTotal] = await Promise.all([
    prisma.lead.count({
      where: {
        companyId,
        deletedAt: null,
        source: { in: ["GOOGLE_MAPS", "BUSINESS_REGISTRY"] },
      },
    }),
    prisma.lead.count({
      where: { companyId, deletedAt: null, hasWebsite: false },
    }),
    prisma.lead.count({
      where: { companyId, deletedAt: null, tags: { has: "modernization" } },
    }),
  ]);

  return (
    <ProspectingClient
      providers={providers.map((p) => ({ name: p.name, live: p.live }))}
      stats={{ importedTotal, noWebsiteTotal, modernizationTotal }}
      settings={{
        prospectingEnabled: settings.prospectingEnabled,
        prospectingQueries: settings.prospectingQueries,
        prospectingNoWebsiteOnly: settings.prospectingNoWebsiteOnly,
        auditWebsites: settings.auditWebsites,
      }}
    />
  );
}
