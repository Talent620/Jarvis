import { prisma } from "@/lib/prisma";
import type {
  ActivityType,
  NotificationType,
  Prisma,
} from "@prisma/client";

/** Append an entry to a lead's activity timeline. */
export async function logActivity(input: {
  companyId: string;
  leadId: string;
  type: ActivityType;
  title: string;
  body?: string | null;
  userId?: string | null;
  meta?: Prisma.InputJsonValue;
}) {
  return prisma.leadActivity.create({
    data: {
      companyId: input.companyId,
      leadId: input.leadId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      userId: input.userId ?? null,
      meta: input.meta,
    },
  });
}

/** Create an in-app notification for the company (optionally a user). */
export async function notify(input: {
  companyId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  userId?: string | null;
  meta?: Prisma.InputJsonValue;
}) {
  return prisma.notification.create({
    data: {
      companyId: input.companyId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      userId: input.userId ?? null,
      meta: input.meta,
    },
  });
}
