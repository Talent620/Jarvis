import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { err, ok, readJson } from "@/lib/api";
import { registerSchema } from "@/lib/validations";
import { DEFAULT_FUNNEL_STAGES } from "@/lib/constants";

export async function POST(req: Request) {
  const body = await readJson(req);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return err("Validation failed", 422, { issues: parsed.error.flatten() });
  }
  const { name, companyName, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return err("An account with this email already exists", 409);

  const passwordHash = await hash(password, 10);

  const company = await prisma.company.create({
    data: {
      name: companyName,
      slug: companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40),
      funnelStages: {
        create: DEFAULT_FUNNEL_STAGES.map((s) => ({
          name: s.name,
          order: s.order,
          probability: s.probability,
          color: s.color,
          isWon: "isWon" in s ? Boolean(s.isWon) : false,
          isLost: "isLost" in s ? Boolean(s.isLost) : false,
        })),
      },
      users: {
        create: { name, email, passwordHash, role: "OWNER" },
      },
    },
    select: { id: true },
  });

  return ok({ ok: true, companyId: company.id }, { status: 201 });
}
