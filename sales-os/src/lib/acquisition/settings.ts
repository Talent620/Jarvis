import type { AcquisitionSettings, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Sensible, conservative defaults for the autopilot. The engine is ON by
 * default (the product's whole point is self-driving acquisition) but every
 * outbound message it produces is *drafted into the approval queue* — nothing
 * is ever sent without a human, and a daily cap bounds how much it sources.
 */
export const ACQUISITION_DEFAULTS = {
  enabled: true,
  cadenceMinutes: 60,
  dailyLeadCap: 25,
  targetPerDay: 10,
  perRunBatch: 5,
  autoDraftInbound: true,
  autoDraftOutbound: true,
  autoEnroll: true,
  enrichLeads: true,
  minScoreToDraft: 0,
  channels: ["EMAIL", "LINKEDIN"],
  quietHoursStart: 21 as number | null,
  quietHoursEnd: 7 as number | null,
  prospectingEnabled: false,
  prospectingQueries: [] as string[],
  prospectingNoWebsiteOnly: true,
  auditWebsites: true,
  autoSendEmails: false,
  dailyEmailCap: 20,
};

/** Get the company's autopilot settings, creating defaults on first access. */
export async function ensureAcquisitionSettings(
  companyId: string,
): Promise<AcquisitionSettings> {
  const existing = await prisma.acquisitionSettings.findUnique({ where: { companyId } });
  if (existing) return existing;
  return prisma.acquisitionSettings.create({
    data: { companyId, ...ACQUISITION_DEFAULTS },
  });
}

export type AcquisitionSettingsPatch = Partial<{
  enabled: boolean;
  cadenceMinutes: number;
  dailyLeadCap: number;
  targetPerDay: number;
  perRunBatch: number;
  autoDraftInbound: boolean;
  autoDraftOutbound: boolean;
  autoEnroll: boolean;
  enrichLeads: boolean;
  minScoreToDraft: number;
  channels: string[];
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  prospectingEnabled: boolean;
  prospectingQueries: string[];
  prospectingNoWebsiteOnly: boolean;
  auditWebsites: boolean;
  autoSendEmails: boolean;
  dailyEmailCap: number;
}>;

export async function updateAcquisitionSettings(
  companyId: string,
  patch: AcquisitionSettingsPatch,
): Promise<AcquisitionSettings> {
  await ensureAcquisitionSettings(companyId);
  return prisma.acquisitionSettings.update({
    where: { companyId },
    data: patch as Prisma.AcquisitionSettingsUpdateInput,
  });
}

/**
 * Resolve the current local hour for a company's timezone (IANA string). Falls
 * back to the host hour if the tz is unknown. No external deps — uses Intl.
 */
export function localHour(timezone: string | null | undefined, now = new Date()): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone || "Europe/Warsaw",
    });
    const h = Number(fmt.format(now));
    return Number.isFinite(h) ? h % 24 : now.getHours();
  } catch {
    return now.getHours();
  }
}

/**
 * Quiet hours are an inclusive-start, exclusive-end window in local time and
 * may wrap past midnight (e.g. 21 → 7). When either bound is null, quiet hours
 * are disabled. During quiet hours the autopilot still *discovers* leads but
 * does not draft fresh outreach, so messages don't get timestamped overnight.
 */
export function isWithinQuietHours(
  settings: Pick<AcquisitionSettings, "quietHoursStart" | "quietHoursEnd">,
  timezone: string | null | undefined,
  now = new Date(),
): boolean {
  const { quietHoursStart: s, quietHoursEnd: e } = settings;
  if (s == null || e == null) return false;
  if (s === e) return false;
  const h = localHour(timezone, now);
  return s < e ? h >= s && h < e : h >= s || h < e;
}
