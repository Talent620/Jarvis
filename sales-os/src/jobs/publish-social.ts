import { publishDuePosts } from "@/lib/social";
import type { JobContext } from "./runner";

/** Publish any scheduled social posts that have come due. */
export async function publishScheduledPosts(ctx: JobContext) {
  return publishDuePosts(ctx.companyId);
}
