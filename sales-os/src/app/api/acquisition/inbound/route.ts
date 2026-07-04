import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuth, parseBody, serverError } from "@/lib/api";
import { inboundConfigSchema } from "@/lib/validations";
import { ensureInboundIntegration } from "@/lib/acquisition/token";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await getAuth();
  if ("res" in a) return a.res;

  try {
    const integ = await ensureInboundIntegration(a.ctx.companyId);
    const cfg = (integ.config ?? {}) as Record<string, unknown>;
    return NextResponse.json({ token: cfg.token ?? null, autoDraft: cfg.autoDraft === true });
  } catch (err) {
    return serverError(err, "acquisition.inbound.GET");
  }
}

export async function PATCH(req: Request) {
  const a = await getAuth();
  if ("res" in a) return a.res;

  const b = await parseBody(req, inboundConfigSchema);
  if ("res" in b) return b.res;

  try {
    const integ = await ensureInboundIntegration(a.ctx.companyId);
    const cfg = (integ.config ?? {}) as Record<string, unknown>;
    const updated = await prisma.integration.update({
      where: { id: integ.id },
      data: {
        config: { ...cfg, autoDraft: b.data.autoDraft } as unknown as Prisma.InputJsonValue,
      },
    });
    const ncfg = (updated.config ?? {}) as Record<string, unknown>;
    return NextResponse.json({ token: ncfg.token ?? null, autoDraft: ncfg.autoDraft === true });
  } catch (err) {
    return serverError(err, "acquisition.inbound.PATCH");
  }
}
