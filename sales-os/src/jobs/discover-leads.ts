import { discoverLeads } from "@/lib/acquisition/discover";
import type { JobContext } from "./runner";

/**
 * Scheduled outbound discovery: sources a small batch of fresh prospects for
 * the company's primary ICP. Trigger from cron/queue in production.
 */
export async function discoverNewLeads({ companyId }: JobContext) {
  return discoverLeads({ companyId, limit: 5 });
}
