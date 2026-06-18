import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const INBOUND_CAPTURE_PROVIDER = "inbound-capture";

export interface ResolvedInbound {
  companyId: string;
  autoDraft: boolean;
}

/** Resolve a workspace from a public capture token (stored on a WEBHOOK integration). */
export async function resolveCompanyByToken(
  token: string | null | undefined,
): Promise<ResolvedInbound | null> {
  // Realne tokeny to 32 hex (randomBytes(16)). Odrzucaj krótkie wcześnie — niższy próg
  // dawał fałszywe poczucie walidacji i ułatwiał zgadywanie.
  if (!token || token.length < 24) return null;
  const integration = await prisma.integration.findFirst({
    where: {
      type: "WEBHOOK",
      provider: INBOUND_CAPTURE_PROVIDER,
      config: { path: ["token"], equals: token },
    },
    select: { companyId: true, config: true },
  });
  if (!integration) return null;
  const cfg = (integration.config ?? {}) as Record<string, unknown>;
  return { companyId: integration.companyId, autoDraft: cfg.autoDraft === true };
}

/** Ensure the company has an inbound-capture integration; create one (with a fresh token) if not. */
export async function ensureInboundIntegration(companyId: string) {
  const existing = await prisma.integration.findFirst({
    where: { companyId, type: "WEBHOOK", provider: INBOUND_CAPTURE_PROVIDER },
  });
  if (existing) return existing;
  return prisma.integration.create({
    data: {
      companyId,
      type: "WEBHOOK",
      provider: INBOUND_CAPTURE_PROVIDER,
      status: "CONNECTED",
      config: { token: randomBytes(16).toString("hex"), autoDraft: true } as Prisma.InputJsonValue,
    },
  });
}

// --- Tiny in-memory rate limiter (per process). Swap for Redis in production. ---
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}
