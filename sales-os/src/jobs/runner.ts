/**
 * Minimal in-process job runner. Deliberately tiny: a typed registry + a
 * sequential executor with timing and error capture. In production you'd back
 * this with a real queue (BullMQ, QStash, cron) — see README roadmap — but the
 * job *logic* lives in pure functions so swapping the trigger is trivial.
 */
export interface JobContext {
  companyId: string;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

export interface JobResult {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export async function runJobs(
  jobs: Record<string, JobHandler>,
  ctx: JobContext,
): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const [name, handler] of Object.entries(jobs)) {
    const start = Date.now();
    try {
      await handler(ctx);
      results.push({ name, ok: true, ms: Date.now() - start });
    } catch (err) {
      results.push({
        name,
        ok: false,
        ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
