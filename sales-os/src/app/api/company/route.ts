import { z } from "zod";
import { getAuth, parseBody, ok, serverError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const companyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  industry: z.string().trim().max(120).nullish(),
  website: z.string().trim().max(200).nullish(),
  timezone: z.string().trim().max(60).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  aiContext: z.string().trim().max(4000).nullish(),
});

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;
  try {
    const company = await prisma.company.findUnique({
      where: { id: a.ctx.companyId },
      include: {
        integrations: { orderBy: { type: "asc" } },
        _count: { select: { users: true, leads: true } },
      },
    });
    return ok(company);
  } catch (e) {
    return serverError(e, "company.GET");
  }
}

export async function PATCH(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;
  const b = await parseBody(req, companyUpdateSchema);
  if ("res" in b) return b.res;
  try {
    const company = await prisma.company.update({
      where: { id: a.ctx.companyId },
      data: {
        ...(b.data.name !== undefined ? { name: b.data.name } : {}),
        ...(b.data.industry !== undefined ? { industry: b.data.industry } : {}),
        ...(b.data.website !== undefined ? { website: b.data.website } : {}),
        ...(b.data.timezone !== undefined ? { timezone: b.data.timezone } : {}),
        ...(b.data.currency !== undefined
          ? { currency: b.data.currency.toUpperCase() }
          : {}),
        ...(b.data.aiContext !== undefined ? { aiContext: b.data.aiContext } : {}),
      },
    });
    return ok(company);
  } catch (e) {
    return serverError(e, "company.PATCH");
  }
}
