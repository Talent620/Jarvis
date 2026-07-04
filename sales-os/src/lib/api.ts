import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { Role } from "@prisma/client";

export interface AuthCtx {
  companyId: string;
  userId: string;
  role: Role;
}

/** JSON success helper. */
export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/** JSON error helper. */
export function err(
  message: string,
  status = 400,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Resolve the authenticated, tenant-scoped context for a route. Returns either
 * `{ ctx }` to proceed, or `{ res }` (a 401) the caller should return as-is:
 *
 *   const a = await getAuth();
 *   if ("res" in a) return a.res;
 *   // use a.ctx.companyId / a.ctx.userId / a.ctx.role
 */
export async function getAuth(): Promise<{ ctx: AuthCtx } | { res: Response }> {
  const session = await auth();
  if (!session?.user?.companyId) return { res: err("Unauthorized", 401) };
  return {
    ctx: {
      companyId: session.user.companyId,
      userId: session.user.id,
      role: session.user.role,
    },
  };
}

/**
 * Parse + validate a JSON body against a Zod schema. Returns either
 * `{ data }` (typed) or `{ res }` (a 422 with flattened issues).
 */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ data: T } | { res: Response }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { res: err("Validation failed", 422, { issues: parsed.error.flatten() }) };
  }
  return { data: parsed.data };
}

/** Read a JSON body without validation (callers validate via safeParse). */
export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Log an unexpected error and return a generic 500. */
export function serverError(e: unknown, tag: string): Response {
  console.error(`[api:${tag}]`, e);
  return err("Internal server error", 500);
}
